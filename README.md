# Stock Radar

미장(NASDAQ·NYSE) **당일 급등주** 보드 + 종목별 1분봉·해외 뉴스 단타 초안.

```bash
node server.js
```

http://127.0.0.1:8787

- `/api/gainers` — 등락률·거래량·상대거래량 필터
- `/api/scan?q=NVDA` — 뉴스 + 당일 롱 시나리오
