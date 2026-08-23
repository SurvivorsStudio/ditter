"""파이프라인 삭제 가드.

삭제는 되돌릴 수 없고(실행 이력·체크포인트가 FK cascade 로 함께 사라진다) 외부 자원까지
건드릴 수 있어서, 무엇을 막고 무엇을 넘기는지가 이 기능의 전부다. 그 판단은 DB 를 타지 않는
순수 함수(`deletion_blockers` / `assert_deletable`)로 떼어 두었고 여기서 고정한다.
"""

from __future__ import annotations

import pytest

from eai_api.schemas.pipeline import DeletionImpact
from eai_api.services.errors import ConflictError
from eai_api.services.pipeline_service import assert_deletable, deletion_blockers


def impact(
    *,
    active_run: str | None = None,
    cdc: str | None = None,
    name: str = "일일 주문 적재",
) -> DeletionImpact:
    return DeletionImpact(
        pipeline_id="p-1",
        pipeline_name=name,
        active_run_id="r-1" if active_run else None,
        active_run_status=active_run,
        cdc_stream_id="s-1" if cdc else None,
        cdc_stream_status=cdc,
        deletable=not (active_run or cdc),
        blockers=deletion_blockers(active_run_status=active_run, cdc_stream_status=cdc),
    )


class TestDeletionBlockers:
    def test_clean_pipeline_has_no_blockers(self) -> None:
        assert deletion_blockers(active_run_status=None, cdc_stream_status=None) == []

    def test_active_run_blocks(self) -> None:
        blockers = deletion_blockers(active_run_status="running", cdc_stream_status=None)
        assert len(blockers) == 1
        assert "running" in blockers[0]

    def test_cdc_stream_blocks(self) -> None:
        blockers = deletion_blockers(active_run_status=None, cdc_stream_status="running")
        assert len(blockers) == 1
        assert "중지" in blockers[0]

    def test_cdc_is_listed_first(self) -> None:
        """force 로도 못 넘기는 쪽을 먼저 보여준다 — 사용자가 할 일이 그것뿐이라서."""
        blockers = deletion_blockers(active_run_status="running", cdc_stream_status="paused")
        assert len(blockers) == 2
        assert "CDC" in blockers[0]


class TestAssertDeletable:
    def test_clean_pipeline_passes(self) -> None:
        assert_deletable(impact())

    def test_history_alone_does_not_block(self) -> None:
        """실행 이력이 있다고 막지는 않는다 — 경고할 일이지 거부할 일이 아니다."""
        snapshot = impact()
        snapshot.runs_total = 1200
        snapshot.checkpoints_total = 3
        assert_deletable(snapshot)

    @pytest.mark.parametrize("status", ["pending", "running"])
    def test_active_run_rejected(self, status: str) -> None:
        with pytest.raises(ConflictError) as exc:
            assert_deletable(impact(active_run=status))
        assert status in str(exc.value)
        assert "force" in str(exc.value)

    @pytest.mark.parametrize("status", ["pending", "running"])
    def test_force_overrides_active_run(self, status: str) -> None:
        """워커가 죽어 running 으로 굳은 실행 때문에 영영 못 지우는 일이 없어야 한다."""
        assert_deletable(impact(active_run=status), force=True)

    @pytest.mark.parametrize("status", ["provisioning", "running", "paused"])
    def test_live_cdc_stream_rejected(self, status: str) -> None:
        with pytest.raises(ConflictError):
            assert_deletable(impact(cdc=status))

    @pytest.mark.parametrize("status", ["provisioning", "running", "paused"])
    def test_force_does_not_override_cdc(self, status: str) -> None:
        """메타DB 행만 지우면 Debezium 커넥터가 주인 없이 남아 계속 토픽에 쓴다."""
        with pytest.raises(ConflictError):
            assert_deletable(impact(cdc=status), force=True)

    def test_cdc_reported_before_run_when_both(self) -> None:
        """둘 다 걸리면 CDC 를 먼저 알린다 — force 를 줘도 어차피 막히므로."""
        with pytest.raises(ConflictError) as exc:
            assert_deletable(impact(active_run="running", cdc="running"), force=True)
        assert "CDC" in str(exc.value)

    def test_message_names_the_pipeline(self) -> None:
        with pytest.raises(ConflictError) as exc:
            assert_deletable(impact(active_run="running", name="야간 정산"))
        assert "야간 정산" in str(exc.value)


class TestConflictErrorContract:
    def test_conflict_maps_to_409(self) -> None:
        """UI 가 409 를 보고 '지울 수 없음'을 구분한다 — 상태코드가 계약의 일부다."""
        assert ConflictError.status_code == 409
