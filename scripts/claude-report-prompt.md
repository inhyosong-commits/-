# Claude 자동 리포트 작업 지시 (예약 작업이 매번 읽는 파일)

저장소 inhyosong-commits/- 의 대시보드에 올릴 "오늘의 AI 보고서"를 씁니다.

1. 숫자 읽기: `gh api "repos/inhyosong-commits/-/contents/snapshot.txt?ref=data" --jq .content | base64 -d`
   (대시보드가 15분마다 저장하는 시세 1일·1주·1개월 변화와 국내외 뉴스 헤드라인)
2. WebSearch로 국내·해외 최신 뉴스를 3~5번 검색해, 크게 움직인 지표가 "왜" 움직였는지 확인합니다.
3. 아래 형식의 JSON을 `data/claude-report.json`에 씁니다 (UTF-8, 이 형식 그대로).
   {"headline":"한 줄 결론(25자 이내)","summary":"세 문장 이내","sections":[{"title":"무슨 일이 있었나","body":"..."},{"title":"왜 그랬나","body":"..."},{"title":"우리에게 미치는 영향","body":"..."},{"title":"앞으로 확인할 것","body":"..."}],"watch":["2~4개"],"citations":["참고한 기사 URL 최대 8개"],"generatedAt":<현재 시각 밀리초 숫자, `date +%s000`>,"model":"claude"}
   - 받는 사람은 한국의 일반 개인 투자자. 존댓말 보고체, 중학생도 알 만큼 쉽게, 전문 용어는 괄호로 풀이.
   - 숫자는 snapshot.txt 기준. 원인은 단정하지 말고 "~로 보입니다". 매수·매도 추천 금지.
   - 한국(코스피, 원화, 수출기업, 물가) 영향은 꼭 포함.
4. `node -e "JSON.parse(require('fs').readFileSync('data/claude-report.json','utf8'))"`로 확인한 뒤
   main 브랜치에 커밋·푸시합니다 (메시지: "Claude 리포트 갱신"). 푸시하면 대시보드가 자동으로 다시 배포됩니다.
5. 다른 파일은 건드리지 않습니다.
