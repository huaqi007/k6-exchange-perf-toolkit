# Dockerfile
FROM grafana/k6:latest

WORKDIR /app

# dist/ 中已包含 mixed-scenario-v2.js + data/ 子目录
# 直接平铺到 /app/，保证 open('./data/orders.json') 能正确解析
COPY dist/ /app/

ENTRYPOINT ["k6"]
# CMD 中的入口名必须和 webpack entry 的 key 一致
CMD ["run", "/app/mixed-scenario-v2.js"]
