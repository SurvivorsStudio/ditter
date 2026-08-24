# NW RFC SDK 배치 위치

SAP NetWeaver RFC SDK 는 **SAP 라이선스가 있어야 받을 수 있는 독점 바이너리**라
저장소에 포함할 수 없습니다. 운영 이미지를 만들 때 여기에 직접 넣으세요.

```
apps/sap-connector/vendor/
└── nwrfcsdk/
    ├── lib/       # libsapnwrfc.so, libicuuc.so …
    └── include/
```

받는 곳: SAP Software Download Center → "SAP NW RFC SDK 7.50" → Linux on x86_64

넣은 뒤 빌드:

```bash
docker compose --profile sap build --build-arg WITH_NWRFC=1 sap-connector
```

SDK 없이 빌드하면(`WITH_NWRFC=0`, 기본) 목 백엔드 전용 이미지가 됩니다.
목은 512자 행폭·72자 OPTIONS 제약을 실제와 똑같이 강제하므로,
파이프라인 저작과 컬럼 분할 로직 검증은 SDK 없이도 할 수 있습니다.


## 로컬(비컨테이너)에서 pyrfc 를 쓸 때

컨테이너는 Linux 라 `LD_LIBRARY_PATH` 를 쓰지만, **macOS 는 `DYLD_LIBRARY_PATH`** 다.

```bash
export SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk
export DYLD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib
```

`pip install pyrfc` 는 위 두 변수가 잡힌 상태에서만 빌드된다.

## PyRFC 와 Python 3

PyRFC 는 Python 2 시절의 `long` 을 참조해서 3.x 에서 그대로 import 하면 깨진다.
공식 유지보수가 중단되어 고쳐질 전망이 없으므로, `backends/nwrfc.py` 가 import 직전에
`builtins.long = int` 를 심는다. 직접 pyrfc 를 쓸 때도 같은 패치가 필요하다.
