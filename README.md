# Stock Radar — 로컬 버전 (키움 API 필요)

이 브랜치(`local`)는 **로컬에서 쓰는 키움 API 버전**입니다. 순위·차트·거래량은 키움 REST를 씁니다. `.env`에 앱 키가 있어야 동작합니다.

무료 야후 버전(키 없음, Render): `main` — https://stock-radar-ku87.onrender.com

## 로컬 실행

```bash
cp .env.example .env
# KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 입력
npm start
```

http://127.0.0.1:8787

- `/api/gainers` — 키움 거래량급증 + 1분 등락·1분 거래량
- `/api/scan?q=NVDA` — 뉴스 + 당일 롱 시나리오
- `/api/chart?symbol=NVDA` — 키움 1분봉 + 거래량
