import json
data = json.load(open('public/streamer_data.json', encoding='utf-8'))
print("总记录:", len(data))
print("字段:", [k for k in data[0].keys()])
days = [r.get('开播天数') for r in data]
nonzero = [d for d in days if d not in (0, 0.0, None, '', False)]
print("开播天数非空数量:", len(nonzero))
print("开播天数示例(前10):", days[:10])
print("开播天数类型:", sorted(set(type(d).__name__ for d in days)))
print("是否包含 是否线下主播 字段:", '是否线下主播' in data[0])
print("运营经纪人 示例:", data[0].get('运营经纪人'))
