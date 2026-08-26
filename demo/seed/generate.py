"""시연용 목데이터 시더 — 쇼핑몰(MySQL) · WMS(MSSQL) · 고객센터(PostgreSQL)를 한 번에 채운다.

**세 DB 를 한 스크립트가 함께 채우는 것이 이 파일의 존재 이유다.**
DB 별로 나누면 order_no·sku·customer_no 같은 DB 를 넘는 키가 반드시 어긋나고,
그러면 연합 조회가 0행을 뱉는다 — 시연에서 가장 나쁜 종류의 실패다.

두 가지를 지킨다.

1. **난수 시드를 고정한다.** 리셋하고 다시 시드해도 같은 데이터가 나온다.
   테이크를 여러 번 가도 화면의 숫자가 바뀌지 않는다.
2. **날짜는 실행 시점 기준 상대값이다.** "오늘로부터 -90일 ~ 오늘".
   고정 날짜를 박으면 촬영이 밀렸을 때 영상에 옛날 데이터가 박제된다.

**식별자가 될 수 있는 값은 실존할 수 없는 것으로 만든다.** 시연 영상에 박제되기 때문이다.
- 이름은 성·이름 목록의 **조합 생성**이다. 실존 인물에서 오지 않았고, 겹쳐도 동명이인이다.
- 전화번호는 가운데 자리를 0 으로 시작하게 둔다. 국내 010 번호는 그 대역을 개통하지 않아
  **실제로 연결되는 번호가 나올 수 없다.** (한국에는 미국 555 같은 공식 예약 대역이 없다.)
- 이메일 도메인은 `example.com` — RFC 2606 이 문서·예시용으로 예약해 실존할 수 없다.
- 창고 주소의 도로명은 지어낸 것이다. 실재 사업장 주소와 겹치지 않게.

조인해야만 보이는 것을 일부러 심는다 (`문제 SKU`) — 재고가 마이너스인 SKU 몇 개가
미출고 지연 주문과 클레임 급증의 원인이 되도록. 발견이 없으면 조인 데모는 심심하다.
"""

from __future__ import annotations

import os
import random
import sys
from datetime import date, datetime, time, timedelta

import psycopg
import pyodbc
import pymysql

# ─────────────────────────────────────────────────────────────────────────────
# 규모 · 상수
# ─────────────────────────────────────────────────────────────────────────────

SEED = 20260826
WINDOW_DAYS = 90          # 트랜잭션이 덮는 기간
PROBLEM_SKU_COUNT = 12    # 재고 마이너스 → 지연 → 클레임 으로 이어지는 SKU

SCALES: dict[str, dict[str, int]] = {
    "small":    {"customers":    300, "products":  120, "orders":   3_000, "movements":    12_000, "claims":    300},
    "standard": {"customers":  2_000, "products":  500, "orders":  50_000, "movements":   200_000, "claims":  3_000},
    "large":    {"customers": 20_000, "products": 2000, "orders": 500_000, "movements": 2_000_000, "claims": 30_000},
}

SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍"]
GIVEN = ["민준", "서연", "도윤", "지우", "예준", "하은", "시우", "서윤", "주원", "지민",
         "건우", "수아", "현우", "채원", "우진", "다은", "선우", "지아", "유준", "소율",
         "정호", "미경", "상현", "은지", "태윤", "혜진", "동현", "나연", "성민", "가은"]
CITIES = ["서울", "부산", "인천", "대구", "대전", "광주", "울산", "수원", "성남", "고양", "용인", "청주", "전주", "천안", "김해"]

CATEGORIES = {
    "가전":   ["공기청정기", "제습기", "무선청소기", "에어프라이어", "전기포트"],
    "주방":   ["프라이팬", "냄비세트", "도마", "밀폐용기", "커피드리퍼"],
    "생활":   ["수납박스", "빨래바구니", "욕실슬리퍼", "행거", "제습제"],
    "패션":   ["기본티셔츠", "청바지", "니트가디건", "스니커즈", "크로스백"],
    "뷰티":   ["수분크림", "선크림", "클렌징폼", "헤어에센스", "립밤"],
    "식품":   ["현미", "올리브유", "견과류믹스", "국산김", "원두커피"],
    "스포츠": ["요가매트", "덤벨세트", "러닝양말", "폼롤러", "물통"],
    "디지털": ["보조배터리", "USB허브", "블루투스이어폰", "무선충전기", "노트북거치대"],
}
BRANDS = ["한빛", "동화", "루메나", "오늘의", "베이직", "코어", "넥스트", "라온"]

WAREHOUSES = [
    ("WH-SEL", "서울 중앙물류센터", "수도권", "서울특별시 강서구 가상물류로 100", "김창고"),
    ("WH-ICN", "이천 대형물류센터", "경기권", "경기도 이천시 마장면 가상센터로 55", "박입고"),
    ("WH-PUS", "부산 남부물류센터", "영남권", "부산광역시 강서구 가상항만로 210", "정출고"),
]

CHANNELS = ["WEB", "MOBILE", "APP", "KAKAO"]
PAY_METHODS = ["CARD", "BANK", "VIRTUAL", "PAY"]
CLAIM_CATEGORIES = ["배송지연", "오배송", "파손", "품절", "환불", "문의"]
CLAIM_CHANNELS = ["전화", "채팅", "이메일", "앱"]

rng = random.Random(SEED)
TODAY = date.today()
NOW = datetime.combine(TODAY, time(9, 0))


def log(msg: str) -> None:
    print(f"[seed] {msg}", flush=True)


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


# ─────────────────────────────────────────────────────────────────────────────
# 생성 — 순서가 곧 의존이다 (마스터 → 주문 → 재고 → 클레임)
# ─────────────────────────────────────────────────────────────────────────────

def gen_customers(n: int) -> list[dict]:
    rows = []
    for i in range(1, n + 1):
        name = rng.choice(SURNAMES) + rng.choice(GIVEN)
        joined = NOW - timedelta(days=rng.randint(30, 1095), minutes=rng.randint(0, 1439))
        rows.append({
            "customer_no": f"C{i:06d}",
            "name": name,
            "email": f"user{i:06d}@example.com",
            "phone": f"010-0{rng.randint(0, 999):03d}-{rng.randint(0, 9999):04d}",
            "grade": rng.choices(["BRONZE", "SILVER", "GOLD", "VIP"], [0.5, 0.3, 0.15, 0.05])[0],
            "city": rng.choice(CITIES),
            "joined_at": joined,
            "created_at": joined,
            "updated_at": joined + timedelta(days=rng.randint(0, 30)),
        })
    return rows


def gen_products(n: int) -> list[dict]:
    cats = list(CATEGORIES)
    rows = []
    for i in range(1, n + 1):
        cat = cats[i % len(cats)]
        noun = rng.choice(CATEGORIES[cat])
        brand = rng.choice(BRANDS)
        price = rng.choice([4900, 7900, 9900, 12900, 19900, 24900, 32000, 45000, 69000, 89000, 129000])
        created = NOW - timedelta(days=rng.randint(90, 900))
        rows.append({
            "sku": f"SKU-{i:05d}",
            "name": f"{brand} {noun} {rng.choice(['1P', '2P', '세트', 'Lite', 'Pro', ''])}".strip(),
            "category": cat,
            "brand": brand,
            "price": price,
            "cost": round(price * rng.uniform(0.55, 0.78), 2),
            "status": "DISCONTINUED" if rng.random() < 0.06 else "ACTIVE",
            "created_at": created,
            "updated_at": created + timedelta(days=rng.randint(0, 60)),
        })
    return rows


def gen_locations() -> list[dict]:
    rows = []
    for wh, *_ in WAREHOUSES:
        for zone in "ABCD":
            for aisle in range(1, 6):
                for rack in range(1, 6):
                    lvl = rng.randint(1, 4)
                    rows.append({
                        "location_code": f"{wh}-{zone}{aisle:02d}{rack:02d}",
                        "warehouse_code": wh,
                        "zone": zone,
                        "aisle": f"{aisle:02d}",
                        "rack": f"{rack:02d}",
                        "lvl": lvl,
                        "location_type": rng.choices(["PICK", "BULK", "RETURN"], [0.7, 0.25, 0.05])[0],
                        "created_at": NOW - timedelta(days=800),
                        "updated_at": NOW - timedelta(days=rng.randint(1, 400)),
                    })
    return rows


def _order_status(age_days: int) -> str:
    if age_days >= 7:
        return rng.choices(["DELIVERED", "SHIPPED", "CANCELLED"], [0.92, 0.03, 0.05])[0]
    if age_days >= 3:
        return rng.choices(["DELIVERED", "SHIPPED", "PICKING", "CANCELLED"], [0.55, 0.30, 0.10, 0.05])[0]
    if age_days >= 1:
        return rng.choices(["SHIPPED", "PICKING", "PAID", "DELIVERED", "CANCELLED"], [0.35, 0.30, 0.20, 0.10, 0.05])[0]
    return rng.choices(["PAID", "PENDING", "PICKING"], [0.5, 0.3, 0.2])[0]


def gen_orders(n: int, customers: list[dict], products: list[dict], problem: set[str]):
    """주문·주문상세·결제를 함께 만든다 — 금액이 상세에서 나오므로 갈라 놓을 수 없다."""
    # 하루치 물량에 요일·추세 가중치를 준다. 평평하면 일별 집계 차트가 밋밋하다.
    weights = []
    for d in range(WINDOW_DAYS):
        day = TODAY - timedelta(days=WINDOW_DAYS - 1 - d)
        w = 1.0 + 0.35 * (d / WINDOW_DAYS)                    # 완만한 성장 추세
        w *= [1.05, 1.0, 1.0, 1.05, 1.2, 0.85, 0.75][day.weekday()]
        if day.day == 1:
            w *= 1.6                                          # 월초 프로모션
        weights.append(w)
    total_w = sum(weights)

    price_of = {p["sku"]: p["price"] for p in products}
    skus = [p["sku"] for p in products]
    # 문제 SKU 가 여러 주문에 실려야 "지연 → 클레임" 사슬이 만들어진다.
    sku_weights = [8.0 if s in problem else rng.uniform(0.4, 3.0) for s in skus]

    orders, items, payments = [], [], []
    seq = 0
    for d in range(WINDOW_DAYS):
        day = TODAY - timedelta(days=WINDOW_DAYS - 1 - d)
        age = (TODAY - day).days
        count = int(round(n * weights[d] / total_w))
        for _ in range(count):
            seq += 1
            hour = rng.choices(range(24), [1, 1, 1, 1, 1, 2, 4, 6, 8, 9, 9, 8, 7, 8, 9, 9, 8, 8, 9, 10, 11, 9, 6, 3])[0]
            ordered_at = datetime.combine(day, time(hour, rng.randint(0, 59), rng.randint(0, 59)))
            if ordered_at > NOW:
                ordered_at = NOW - timedelta(minutes=rng.randint(1, 300))
            order_no = f"SO-{day:%Y%m%d}-{seq:06d}"
            cust = rng.choice(customers)
            status = _order_status(age)

            n_lines = rng.choices([1, 2, 3, 4, 5, 6], [0.45, 0.25, 0.14, 0.08, 0.05, 0.03])[0]
            picked = rng.choices(skus, sku_weights, k=n_lines)
            total = 0.0
            for line_no, sku in enumerate(dict.fromkeys(picked), start=1):   # 같은 SKU 중복 제거
                qty = rng.choices([1, 2, 3, 5], [0.7, 0.2, 0.07, 0.03])[0]
                unit = price_of[sku]
                amount = unit * qty
                total += amount
                items.append((order_no, line_no, sku, qty, unit, amount, ordered_at, ordered_at))
            discount = round(total * rng.choice([0, 0, 0, 0.05, 0.1]), 2)

            shipped_at = None
            if status in ("SHIPPED", "DELIVERED"):
                shipped_at = ordered_at + timedelta(days=rng.randint(1, 3), hours=rng.randint(0, 12))
                if shipped_at > NOW:
                    shipped_at = NOW
            updated_at = shipped_at or ordered_at
            orders.append({
                "order_no": order_no, "customer_no": cust["customer_no"], "ordered_at": ordered_at,
                "status": status, "channel": rng.choices(CHANNELS, [0.25, 0.35, 0.3, 0.1])[0],
                "total_amount": round(total, 2), "discount_amount": discount,
                "payment_method": rng.choices(PAY_METHODS, [0.55, 0.15, 0.1, 0.2])[0],
                "shipped_at": shipped_at, "created_at": ordered_at, "updated_at": updated_at,
                "skus": set(dict.fromkeys(picked)),
            })
            if status != "PENDING":
                paid_at = ordered_at + timedelta(minutes=rng.randint(1, 90))
                payments.append((
                    f"PY-{seq:08d}", order_no,
                    orders[-1]["payment_method"], round(total - discount, 2),
                    "REFUNDED" if status == "CANCELLED" else "PAID",
                    paid_at, paid_at, paid_at,
                ))
    return orders, items, payments


def mark_delayed(orders: list[dict], problem: set[str], target: int) -> list[dict]:
    """"결제는 됐는데 일주일 넘게 안 나간" 주문을 심는다 — 연합 조회의 발견 지점."""
    delayed = []
    for o in orders:
        if len(delayed) >= target:
            break
        age = (TODAY - o["ordered_at"].date()).days
        if 8 <= age <= 45 and o["skus"] & problem and o["status"] in ("DELIVERED", "SHIPPED"):
            o["status"] = "PAID"
            o["shipped_at"] = None
            o["updated_at"] = o["ordered_at"] + timedelta(hours=rng.randint(1, 20))
            delayed.append(o)
    return delayed


def gen_inventory(products: list[dict], locations: list[dict], problem: set[str]):
    by_wh: dict[str, list[str]] = {}
    for loc in locations:
        by_wh.setdefault(loc["warehouse_code"], []).append(loc["location_code"])

    rows = []
    for p in products:
        for wh, *_ in WAREHOUSES:
            on_hand = rng.randint(0, 40) if rng.random() < 0.12 else rng.randint(40, 900)
            # 정상 재고는 절대 마이너스가 되지 않게 한다 — 마이너스는 문제 SKU 만의 표식이라
            # 우연히 섞이면 "재고 마이너스 = 원인" 이라는 시연의 연결고리가 흐려진다.
            allocated = rng.randint(0, on_hand // 4) if on_hand else 0
            if p["sku"] in problem and wh == "WH-SEL":
                # 실물보다 많이 잡혀 있다 = 팔렸는데 물건이 없다. 지연의 원인.
                on_hand = rng.randint(0, 5)
                allocated = on_hand + rng.randint(8, 60)
            rows.append((
                p["sku"], wh, rng.choice(by_wh[wh]),
                on_hand, allocated, on_hand - allocated,
                NOW - timedelta(days=rng.randint(1, 120)),
                NOW - timedelta(hours=rng.randint(1, 720)),
            ))
    return rows


def gen_movements(orders: list[dict], items_by_order: dict, products, target: int):
    """출고는 실제 주문을 참조하고(ref_no=order_no), 나머지는 입고·조정으로 채운다."""
    rows = []
    seq = 0
    wh_codes = [w[0] for w in WAREHOUSES]
    workers = [f"{rng.choice(SURNAMES)}{rng.choice(GIVEN)}" for _ in range(30)]

    for o in orders:
        if len(rows) >= target:
            break
        if o["status"] not in ("SHIPPED", "DELIVERED"):
            continue
        moved = o["shipped_at"] or o["ordered_at"]
        for (_, _, sku, qty, *_rest) in items_by_order.get(o["order_no"], []):
            seq += 1
            wh = rng.choice(wh_codes)
            rows.append((
                f"MV-{seq:08d}", sku, wh, f"{wh}-{rng.choice('ABCD')}{rng.randint(1,5):02d}{rng.randint(1,5):02d}",
                "OUT", -qty, o["order_no"], rng.choice(workers), moved, moved,
            ))

    skus = [p["sku"] for p in products]
    while len(rows) < target:
        seq += 1
        wh = rng.choice(wh_codes)
        mtype = rng.choices(["IN", "ADJ", "MOVE"], [0.75, 0.1, 0.15])[0]
        qty = rng.randint(20, 400) if mtype == "IN" else rng.randint(-30, 30)
        moved = NOW - timedelta(days=rng.randint(0, WINDOW_DAYS), minutes=rng.randint(0, 1439))
        rows.append((
            f"MV-{seq:08d}", rng.choice(skus), wh,
            f"{wh}-{rng.choice('ABCD')}{rng.randint(1,5):02d}{rng.randint(1,5):02d}",
            mtype, qty, None, rng.choice(workers), moved, moved,
        ))
    return rows


def gen_outbound(orders: list[dict], delayed_nos: set[str]):
    rows = []
    for i, o in enumerate(orders, start=1):
        if o["status"] in ("PENDING", "CANCELLED"):
            continue
        wh = rng.choices([w[0] for w in WAREHOUSES], [0.5, 0.3, 0.2])[0]
        requested = o["ordered_at"] + timedelta(minutes=rng.randint(10, 240))
        if o["order_no"] in delayed_nos:
            rows.append((f"OB-{i:08d}", o["order_no"], wh, "HOLD", requested, None, None,
                         None, "재고부족 — 실재고 확인 필요", requested))
            continue
        picked = shipped = None
        status = "WAITING"
        if o["status"] in ("PICKING", "SHIPPED", "DELIVERED"):
            picked = requested + timedelta(hours=rng.randint(1, 20))
            status = "PICKING"
        if o["status"] in ("SHIPPED", "DELIVERED"):
            shipped = o["shipped_at"]
            status = "SHIPPED"
        rows.append((f"OB-{i:08d}", o["order_no"], wh, status, requested, picked, shipped,
                     f"{rng.choice(SURNAMES)}{rng.choice(GIVEN)}" if picked else None, None,
                     shipped or picked or requested))
    return rows


def gen_agents() -> list[tuple]:
    teams = ["1팀", "2팀", "3팀", "VIP전담"]
    return [
        (f"AG{i:03d}", rng.choice(SURNAMES) + rng.choice(GIVEN), rng.choice(teams),
         TODAY - timedelta(days=rng.randint(60, 2000)))
        for i in range(1, 21)
    ]


def gen_claims(n: int, orders: list[dict], delayed: list[dict], agents: list[tuple], problem: set[str]):
    """35% 를 3일에 몰아 넣는다 — 모니터·집계에서 '무슨 일이 있었다'가 눈에 보이게."""
    spike_days = [TODAY - timedelta(days=d) for d in (21, 14, 7)]
    agent_ids = [a[0] for a in agents]
    rows = []
    n_spike = int(n * 0.35)

    pool = delayed or orders
    for i in range(1, n_spike + 1):
        o = rng.choice(pool)
        day = rng.choice(spike_days)
        opened = datetime.combine(day, time(rng.randint(9, 20), rng.randint(0, 59)))
        sku = next(iter(o["skus"] & problem), None) or rng.choice(sorted(o["skus"]))
        rows.append((
            f"CL-{i:06d}", o["order_no"], o["customer_no"], sku,
            rng.choices(["배송지연", "품절"], [0.7, 0.3])[0],
            rng.choice(CLAIM_CHANNELS),
            rng.choices(["HIGH", "URGENT"], [0.6, 0.4])[0],
            status := rng.choices(["OPEN", "IN_PROGRESS", "RESOLVED"], [0.35, 0.35, 0.3])[0],
            rng.choice(agent_ids),
            "주문한 지 일주일이 지났는데 출고가 되지 않았습니다.",
            opened,
            opened + timedelta(hours=rng.randint(2, 72)) if status == "RESOLVED" else None,
            opened,
        ))

    for i in range(n_spike + 1, n + 1):
        o = rng.choice(orders)
        opened = o["ordered_at"] + timedelta(days=rng.randint(0, 10), hours=rng.randint(0, 23))
        if opened > NOW:
            opened = NOW - timedelta(hours=rng.randint(1, 48))
        status = rng.choices(["CLOSED", "RESOLVED", "IN_PROGRESS", "OPEN"], [0.5, 0.25, 0.15, 0.1])[0]
        closed = opened + timedelta(hours=rng.randint(2, 96)) if status in ("CLOSED", "RESOLVED") else None
        if closed and closed > NOW:
            closed = NOW
        rows.append((
            f"CL-{i:06d}", o["order_no"], o["customer_no"], rng.choice(sorted(o["skus"])),
            rng.choices(CLAIM_CATEGORIES, [0.2, 0.1, 0.12, 0.1, 0.18, 0.3])[0],
            rng.choice(CLAIM_CHANNELS),
            rng.choices(["LOW", "MEDIUM", "HIGH", "URGENT"], [0.4, 0.38, 0.17, 0.05])[0],
            status, rng.choice(agent_ids),
            "고객 문의 접수 건입니다.",
            opened, closed, closed or opened,
        ))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# 적재
# ─────────────────────────────────────────────────────────────────────────────

def chunks(rows: list, size: int):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def load_mysql(customers, products, orders, items, payments) -> None:
    conn = pymysql.connect(
        host=env("DEMO_MYSQL_HOST", "mysql-shop"), port=int(env("DEMO_MYSQL_PORT", "3306")),
        user=env("DEMO_MYSQL_USER", "eai_ddl"), password=env("DEMO_MYSQL_PASSWORD", ""),
        database="shop", charset="utf8mb4", autocommit=False,
    )
    with conn, conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        for t in ("payments", "order_items", "orders", "products", "customers"):
            cur.execute(f"TRUNCATE TABLE {t}")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")

        cur.executemany(
            "INSERT INTO customers (customer_no,name,email,phone,grade,city,joined_at,created_at,updated_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [(c["customer_no"], c["name"], c["email"], c["phone"], c["grade"], c["city"],
              c["joined_at"], c["created_at"], c["updated_at"]) for c in customers])
        cur.executemany(
            "INSERT INTO products (sku,name,category,brand,price,cost,status,created_at,updated_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [(p["sku"], p["name"], p["category"], p["brand"], p["price"], p["cost"],
              p["status"], p["created_at"], p["updated_at"]) for p in products])
        conn.commit()
        log(f"MySQL  customers {len(customers):,} · products {len(products):,}")

        sql = ("INSERT INTO orders (order_no,customer_no,ordered_at,status,channel,total_amount,"
               "discount_amount,payment_method,shipped_at,created_at,updated_at)"
               " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)")
        for batch in chunks(orders, 5000):
            cur.executemany(sql, [(o["order_no"], o["customer_no"], o["ordered_at"], o["status"],
                                   o["channel"], o["total_amount"], o["discount_amount"],
                                   o["payment_method"], o["shipped_at"], o["created_at"],
                                   o["updated_at"]) for o in batch])
            conn.commit()
        log(f"MySQL  orders {len(orders):,}")

        sql = ("INSERT INTO order_items (order_no,line_no,sku,qty,unit_price,amount,created_at,updated_at)"
               " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)")
        for batch in chunks(items, 10000):
            cur.executemany(sql, batch)
            conn.commit()
        log(f"MySQL  order_items {len(items):,}")

        sql = ("INSERT INTO payments (payment_no,order_no,method,amount,status,paid_at,created_at,updated_at)"
               " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)")
        for batch in chunks(payments, 10000):
            cur.executemany(sql, batch)
            conn.commit()
        log(f"MySQL  payments {len(payments):,}")


def load_mssql(products, locations, inventory, movements, outbound) -> None:
    dsn = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={env('DEMO_MSSQL_HOST', 'mssql-wms')},{env('DEMO_MSSQL_PORT', '1433')};"
        "DATABASE=wms;"
        f"UID={env('DEMO_MSSQL_USER', 'eai_ddl')};PWD={env('DEMO_MSSQL_PASSWORD', '')};"
        "TrustServerCertificate=yes;Encrypt=yes;"
    )
    conn = pyodbc.connect(dsn, autocommit=False)
    cur = conn.cursor()
    cur.fast_executemany = True     # 없으면 20만 건이 분 단위로 길어진다

    for t in ("stock_movements", "outbound_orders", "inventory", "locations", "items", "warehouses"):
        cur.execute(f"TRUNCATE TABLE dbo.{t}")
    conn.commit()

    cur.executemany(
        "INSERT INTO dbo.warehouses (warehouse_code,warehouse_name,region,address,manager,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?)",
        [(w[0], w[1], w[2], w[3], w[4], NOW - timedelta(days=900), NOW - timedelta(days=30)) for w in WAREHOUSES])

    cur.executemany(
        "INSERT INTO dbo.items (item_code,item_name,category,unit,safety_stock,abc_class,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        [(p["sku"], p["name"], p["category"], rng.choice(["EA", "BOX", "SET"]),
          rng.choice([10, 20, 30, 50, 100]), rng.choices(["A", "B", "C"], [0.2, 0.3, 0.5])[0],
          p["created_at"], p["updated_at"]) for p in products])

    cur.executemany(
        "INSERT INTO dbo.locations (location_code,warehouse_code,zone,aisle,rack,lvl,location_type,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        [(l["location_code"], l["warehouse_code"], l["zone"], l["aisle"], l["rack"], l["lvl"],
          l["location_type"], l["created_at"], l["updated_at"]) for l in locations])
    conn.commit()
    log(f"MSSQL  warehouses {len(WAREHOUSES)} · items {len(products):,} · locations {len(locations):,}")

    for batch in chunks(inventory, 5000):
        cur.executemany(
            "INSERT INTO dbo.inventory (item_code,warehouse_code,location_code,on_hand_qty,"
            "allocated_qty,available_qty,last_counted_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", batch)
        conn.commit()
    log(f"MSSQL  inventory {len(inventory):,}")

    for batch in chunks(outbound, 5000):
        cur.executemany(
            "INSERT INTO dbo.outbound_orders (outbound_no,order_no,warehouse_code,status,requested_at,"
            "picked_at,shipped_at,picker,hold_reason,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", batch)
        conn.commit()
    log(f"MSSQL  outbound_orders {len(outbound):,}")

    for batch in chunks(movements, 10000):
        cur.executemany(
            "INSERT INTO dbo.stock_movements (movement_no,item_code,warehouse_code,location_code,"
            "movement_type,qty,ref_no,moved_by,moved_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", batch)
        conn.commit()
    log(f"MSSQL  stock_movements {len(movements):,}")
    conn.close()


def load_postgres(agents, claims) -> None:
    host, port = env("DEMO_PG_HOST", "postgres-crm"), env("DEMO_PG_PORT", "5432")
    user, pw = env("DEMO_PG_USER", "eai_ddl"), env("DEMO_PG_PASSWORD", "")

    with psycopg.connect(f"host={host} port={port} dbname=crm user={user} password={pw}") as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE claims, agents RESTART IDENTITY CASCADE")
            cur.executemany(
                "INSERT INTO agents (agent_id,agent_name,team,hired_at) VALUES (%s,%s,%s,%s)", agents)
            for batch in chunks(claims, 5000):
                cur.executemany(
                    "INSERT INTO claims (claim_no,order_no,customer_no,sku,category,channel,severity,"
                    "status,agent_id,summary,opened_at,closed_at,updated_at)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", batch)
        conn.commit()
    log(f"PG     agents {len(agents)} · claims {len(claims):,}")

    # 마트(dw)는 **비운다.** 파이프라인이 채우는 것을 보여주는 자리라 시작은 0행이어야 한다.
    with psycopg.connect(f"host={host} port={port} dbname=dw user={user} password={pw}") as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE sales_daily, orders_live, inventory")
        conn.commit()
    log("PG     dw 초기화 (0행 — 파이프라인이 채운다)")


# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    scale_name = env("DEMO_SCALE", "standard")
    if scale_name not in SCALES:
        print(f"알 수 없는 DEMO_SCALE: {scale_name} (가능: {', '.join(SCALES)})", file=sys.stderr)
        return 2
    scale = SCALES[scale_name]
    log(f"규모 '{scale_name}' · 기준일 {TODAY} · 시드 {SEED}")

    customers = gen_customers(scale["customers"])
    products = gen_products(scale["products"])
    locations = gen_locations()
    problem = {p["sku"] for p in rng.sample(products, PROBLEM_SKU_COUNT)}
    log(f"문제 SKU {len(problem)}종 — 재고 마이너스 → 미출고 지연 → 클레임 급증으로 이어진다")

    orders, items, payments = gen_orders(scale["orders"], customers, products, problem)
    delayed = mark_delayed(orders, problem, target=max(20, int(len(orders) * 0.0068)))
    log(f"생성 orders {len(orders):,} · items {len(items):,} · 지연 주문 {len(delayed):,}")

    items_by_order: dict[str, list] = {}
    for it in items:
        items_by_order.setdefault(it[0], []).append(it)

    inventory = gen_inventory(products, locations, problem)
    movements = gen_movements(orders, items_by_order, products, scale["movements"])
    outbound = gen_outbound(orders, {o["order_no"] for o in delayed})
    agents = gen_agents()
    claims = gen_claims(scale["claims"], orders, delayed, agents, problem)

    load_mysql(customers, products, orders, items, payments)
    load_mssql(products, locations, inventory, movements, outbound)
    load_postgres(agents, claims)

    log("완료. 세 DB 의 order_no · sku · customer_no 는 서로 맞물려 있다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
