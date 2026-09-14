import json
data = json.load(open('public/streamer_data.json', encoding='utf-8'))
days = [r.get('开播天数', 0) for r in data]
print("开播天数>0 数量:", sum(1 for d in days if d and d > 0))
print("开播天数样本(前12):", days[:12])
print("类型:", sorted(set(type(d).__name__ for d in days)))
