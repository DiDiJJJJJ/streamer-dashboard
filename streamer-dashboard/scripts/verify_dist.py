import json
data = json.load(open('dist/streamer_data.json', encoding='utf-8'))
days = [r.get('开播天数', 0) for r in data]
print("dist 记录数:", len(data))
print("dist 开播天数>0 数量:", sum(1 for d in days if d and d > 0))
print("dist 含NaN:", 'NaN' in open('dist/streamer_data.json', encoding='utf-8').read())
print("dist 含招募经纪人:", '招募经纪人' in open('dist/streamer_data.json', encoding='utf-8').read())
