"""사용자·인증 API 스키마. 비밀번호 해시는 절대 응답에 실리지 않는다."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str
    roles: list[str]
    is_active: bool
    last_login_at: datetime | None = None
    created_at: datetime


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    roles: list[str] = Field(min_length=1)
    display_name: str = ""


class UserRolesUpdate(BaseModel):
    roles: list[str] = Field(min_length=1)


class UserActiveUpdate(BaseModel):
    is_active: bool


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class PasswordReset(BaseModel):
    """관리자가 남의 비밀번호를 재설정할 때 — 현재 비밀번호를 요구하지 않는다."""

    new_password: str = Field(min_length=1, max_length=256)
