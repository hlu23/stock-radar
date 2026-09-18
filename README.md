# Stock Radar V2 — Yahoo 무료 (본장 전용)

무료 사이트: https://stock-radar-ku87.onrender.com

미장(NASDAQ·NYSE) **본장 전용** 급등주 보드 + 종목별 1분봉·해외 뉴스 단타 초안.

이 배포본은 **야후 파이낸스**만 씁니다. API 키 없이 Render 무료 플랜으로 돌아갑니다. 차트·거래량·1분 등락·1분 거래량은 야후 1분봉과 호가입니다. 창이 가려져 있어도 서버가 호가를 이어 받습니다.

키움 API 로컬 버전은 `local` 브랜치입니다.

로컬 실행:

```bash
npm start
```

http://127.0.0.1:8787

- `/api/gainers` — 등락률·거래량·상대거래량 필터
- `/api/scan?q=NVDA` — 뉴스 + 당일 롱 시나리오
- `/api/chart?symbol=NVDA` — 야후 1분봉 + 거래량
