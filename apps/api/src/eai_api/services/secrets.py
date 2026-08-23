"""시크릿 저장소.

원칙(설계 문서 §4, §11): **시크릿 원문은 메타DB에 저장하지 않는다.**
Connection 에는 ``secret_ref`` 만 남고, 실제 값은 백엔드에서 복호화한다.

- ``local``   : Fernet 대칭키로 암호화한 값을 ``secrets`` 테이블에 보관. 개발/단일노드용.
- ``aws_kms`` : KMS Encrypt/Decrypt(envelope) 사용. 운영 기본값.
"""

from __future__ import annotations

import base64
import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy import String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from ..config import SecretBackend, Settings, get_settings
from ..models.base import Base, TimestampMixin, new_uuid

logger = logging.getLogger(__name__)


class SecretBlob(Base, TimestampMixin):
    """암호문 보관 테이블. 평문은 어떤 경우에도 여기 들어가지 않는다."""

    __tablename__ = "secret_blobs"

    ref: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_uuid)
    backend: Mapped[str] = mapped_column(String(16), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)  # base64


class SecretStore(ABC):
    """``dict`` 시크릿을 저장/조회한다."""

    backend: SecretBackend

    def __init__(self, session: Session) -> None:
        self.session = session

    @abstractmethod
    def _encrypt(self, plaintext: bytes) -> bytes: ...

    @abstractmethod
    def _decrypt(self, ciphertext: bytes) -> bytes: ...

    def put(self, secret: dict[str, Any], *, ref: str | None = None) -> str:
        """시크릿을 저장하고 ``secret_ref`` 를 돌려준다. 같은 ref 면 덮어쓴다."""
        payload = json.dumps(secret, ensure_ascii=False).encode("utf-8")
        blob = base64.b64encode(self._encrypt(payload)).decode("ascii")
        existing = self.session.get(SecretBlob, ref) if ref else None
        if existing is not None:
            existing.ciphertext = blob
            existing.backend = str(self.backend)
            return existing.ref
        record = SecretBlob(ref=ref or new_uuid(), backend=str(self.backend), ciphertext=blob)
        self.session.add(record)
        self.session.flush()
        return record.ref

    def get(self, ref: str | None) -> dict[str, Any]:
        if not ref:
            return {}
        record = self.session.execute(select(SecretBlob).where(SecretBlob.ref == ref)).scalar_one_or_none()
        if record is None:
            logger.warning("secret_ref 를 찾을 수 없습니다: %s", ref)
            return {}
        raw = self._decrypt(base64.b64decode(record.ciphertext))
        decoded: dict[str, Any] = json.loads(raw.decode("utf-8"))
        return decoded

    def delete(self, ref: str | None) -> None:
        if not ref:
            return
        record = self.session.get(SecretBlob, ref)
        if record is not None:
            self.session.delete(record)


class LocalSecretStore(SecretStore):
    backend = SecretBackend.LOCAL

    def __init__(self, session: Session, key: str) -> None:
        super().__init__(session)
        if not key:
            raise RuntimeError(
                "EAI_LOCAL_SECRET_KEY 가 비어 있습니다. "
                'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" '
                "로 생성해 .env 에 넣으세요."
            )
        from cryptography.fernet import Fernet

        self._fernet = Fernet(key.encode() if isinstance(key, str) else key)

    def _encrypt(self, plaintext: bytes) -> bytes:
        return self._fernet.encrypt(plaintext)

    def _decrypt(self, ciphertext: bytes) -> bytes:
        return self._fernet.decrypt(ciphertext)


class KmsSecretStore(SecretStore):
    backend = SecretBackend.AWS_KMS

    def __init__(self, session: Session, key_id: str, region: str = "ap-northeast-2") -> None:
        super().__init__(session)
        if not key_id:
            raise RuntimeError("EAI_KMS_KEY_ID 가 필요합니다 (secret_backend=aws_kms)")
        import boto3

        self._key_id = key_id
        self._kms = boto3.client("kms", region_name=region)

    def _encrypt(self, plaintext: bytes) -> bytes:
        # KMS Encrypt 는 4KB 상한. 접속 시크릿은 이보다 훨씬 작아 직접 암호화로 충분하다.
        if len(plaintext) > 4096:
            raise ValueError("시크릿이 4KB 를 초과합니다 — envelope 암호화가 필요합니다")
        blob: bytes = self._kms.encrypt(KeyId=self._key_id, Plaintext=plaintext)["CiphertextBlob"]
        return blob

    def _decrypt(self, ciphertext: bytes) -> bytes:
        plain: bytes = self._kms.decrypt(CiphertextBlob=ciphertext)["Plaintext"]
        return plain


def get_secret_store(session: Session, settings: Settings | None = None) -> SecretStore:
    s = settings or get_settings()
    if s.secret_backend is SecretBackend.AWS_KMS:
        import os

        return KmsSecretStore(session, s.kms_key_id, os.getenv("AWS_REGION", "ap-northeast-2"))
    return LocalSecretStore(session, s.local_secret_key)
