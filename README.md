# Celeris WebGPU Case Builder

브라우저에서 이상조건 지형·계산격자·방파제·단일 규칙파를 설계하고 Celeris 입력 ZIP을 생성합니다.
**Colab/서버 연결 없이 Pyodide Python이 Web Worker에서 실행됩니다.** 최초 실행은 인터넷 연결이 필요합니다.

## 실행과 GitHub Pages

GitHub 저장소의 **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save**를 선택합니다.
저장소가 Private이면 현재 GitHub 요금제의 Pages 지원을 확인하세요. 이 프로젝트는 저장소 공개 설정을 변경하지 않습니다.
게시 URL은 GitHub Pages 설정 화면에서 확인할 수 있습니다. Pages를 활성화하기 전에는 저장소 URL이 홈페이지가 아닙니다.

로컬 미리보기:

```sh
python -m http.server 8000
```

`http://localhost:8000`을 엽니다. `file://`로 직접 열면 Worker/파일 요청이 차단될 수 있습니다.

## 기능

- 좌측 Grid / Bathymetry / 다중 방파제, 중앙 Canvas 지형·격자·파봉선·x 단면, 우측 규칙파 및 config.
- 일정 수심, 경사면, 계단, 3단 계단, Gaussian 사주·수로, 원뿔형 섬.
- 방파제 활성화, 0-based 중심 인덱스, 길이·두께·각도·마루표고. 마루표고 < 0이면 잠제.
- 단일 입사 경계, H/T 또는 H/L, 위상, 방향. 선형 분산관계로 T/L 상호 변환.
- 젖은 셀의 평균 수심 기준 상대수심 분류, 조파 수심, 파장당 셀 수.
- 확대/이동, 격자·파봉선 표시, 애니메이션 일시정지, 클릭한 y의 지형 단면.
- Python 검증과 지형 생성을 미리보기/ZIP 출력에서 공통 사용.
- dry 및 구조물이 있는 입사 경계 비활성화, 외향 입사·비정상 수치·도메인 밖 구조물 저장 차단.
- 설정 JSON 다시 불러오기. 최대 1,048,576셀, 방파제 30개.

## 좌표 / 출력 규약

정수면은 0 m로 고정. 바닥표고 z는 위쪽이 양수, 수심 h=max(0,-z).
Lx/Ly는 셀 바깥 경계 간 거리이고 dx=Lx/nx, dy=Ly/ny. 지형 샘플은 셀 중심에 배치합니다.
Celeris가 표시하는 i*dx 좌표와는 반 셀 원점 차이가 있습니다.
파/구조물 방향은 +x에서 반시계 방향: 0° 동쪽, 90° 북쪽. 파의 '오는 방향'이 아닌 '가는 방향'입니다.

ZIP 파일:

| 파일 | 내용 |
|---|---|
| bathy.txt | ny행 × nx열, 첫 행 남쪽, 첫 열 서쪽, 바닥표고 m |
| waves.txt | NumberOfWaves 1; 진폭 H/2, 주기 s, 진행각 rad, 위상 rad |
| config.json | Cartesian, NLSW/Boussinesq, 마찰, 단일 조파 경계 및 나머지 경계 |
| case_settings.json | 버전 1 전체 설계값. 홈페이지에서 다시 불러오기 |
| validation_report.json | 수심/파랑 지표, 경고와 적용 한계 |

`incident_wave_type=-1`로 파일의 성분을 사용합니다. 정현파의 significant_wave_height는 H/sqrt(2)로 저장합니다.
`base_depth`는 선택한 조파 경계 보호 구간의 평균 수심입니다. 최대 수심과 다를 수 있으므로 실제 실행의 CFL/시간간격도 확인하세요.

## Celeris 소스 확인 (2026-10-29)

공개 upstream `plynett/plynett.github.io`의 다음 소스를 확인했습니다. 사용자의 별도 수정본과 실제 시뮬레이션 실행까지 검증한 것은 아닙니다.

- `js/File_Loader.js`, blob `5e03095a56b989b054c9b05892b3dbcd671ce0f3`: bathy 행/열 파싱, waves 헤더와 성분.
- `shaders/BoundaryPass.wgsl`, blob `a460c2475115db2c4da5936a5291a98aa9193a42`: 진폭·주기·각도·위상 사용, 바깥 3셀 조파, base_depth 기준 근사 분산식.
- `js/constants_load_calc.js`, blob `5abbe9ec8905f9f43dea9ed1e1c7954cb44fe6c6`: Cartesian grid_type=1, custom waves incident_wave_type=-1.

입력 loader는 외곽 지형을 내부 4번째 인덱스의 값으로 평탄화합니다. 따라서 UI 검사는 바깥 **5셀**까지 보수적으로 검사합니다. 원본 설계 미리보기와 Celeris에서 경계/단일셀 정리 후의 지형이 다를 수 있습니다.

## 물리적 한계

- 파봉 애니메이션은 입력 방향을 보여주는 그림이며 실제 회절·반사·굴절·쇄파 계산이 아닙니다. dry 영역 위에도 방향선이 겹칠 수 있습니다.
- 표시 L은 정확한 선형 분산관계 해입니다. 확인한 Celeris 조파 코드는 근사식을 사용하므로 별도의 `Celeris 근사식 L`도 표시합니다.
- 단일 조파 경계만 지원합니다. 사입사 시 인접 경계·모서리 효과를 검토하세요.
- 방파제는 지형을 높인 불투과 구조물입니다. 다공성 투과는 지원하지 않습니다.
- 넓은 지형 변화에 한 개의 평균수심 지표로 모형의 정확도를 보증할 수 없습니다. 경고는 수렴성 검증을 대신하지 않습니다.
- 브라우저 최대 셀 수는 메모리 보호용 제한입니다. 최대 크기의 성능은 기기에 따라 다릅니다.
- Pyodide 0.27.7을 버전 고정하여 jsDelivr에서 불러옵니다. 입력 설계값은 외부 계산 서버로 전송하지 않습니다.

## Python CLI / 테스트

```sh
python engine.py case_settings.json -o celeris_case.zip
python -m unittest -v
```

Python 표준 라이브러리만 사용합니다. 브라우저와 CLI 모두 같은 `engine.py`를 사용합니다.

## 검증

9개 자동 테스트: 분산관계, 출력 ZIP/행렬/헤더, 7개 지형, 지형 방향, 외향 입사 차단, 잠제/경계 충돌, dry·과대 파고, 파장입력, 잘못된 수치 및 크기 제한.
브라우저 검증 결과는 `VALIDATION.md`에 기록합니다.
