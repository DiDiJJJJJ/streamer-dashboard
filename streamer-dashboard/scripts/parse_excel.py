import pandas as pd
import json
import re
from pathlib import Path

# 默认读取桌面最新主播数据文件；可通过命令行参数传入
import sys
if len(sys.argv) > 1:
    file = sys.argv[1]
else:
    file = r"C:\Users\Administrator\Desktop\线下主播看板\主播数据_2026.8.1-2026.8.7.xlsx"

print(f"读取文件: {file}")
df = pd.read_excel(file, sheet_name='主播数据')

# 清洗字段名
df.columns = [c.strip() for c in df.columns]

# 数值清洗
def clean_money(x):
    if pd.isna(x) or x == '-' or x == '':
        return 0.0
    try:
        s = str(x).replace('元', '').replace(',', '').strip()
        return float(s)
    except Exception:
        return 0.0

money_cols = ['总流水（元）', '总收益（元）', '主播自提礼物收益', '语聊房嘉宾收益（元）',
              '专属互动礼物收益（元）', 'pk流水']
for c in money_cols:
    if c in df.columns:
        df[c] = df[c].apply(clean_money)

def clean_num(x):
    if pd.isna(x) or x == '-' or x == '':
        return 0
    s = re.sub(r'[天元小时%,\s]', '', str(x))
    s = s.strip()
    try:
        n = float(s)
        return int(n) if n.is_integer() else n
    except Exception:
        return 0

num_cols = ['粉丝数', '新增粉丝数', '弹幕数', '开播天数', '开播时长（小时）', 'pk次数',
            'pk付费人数', '违规次数', '峰值在线人数（pcu）', '平均在线人数（acu）',
            '付费人数', '大航海人数', '发布动态数量']
for c in num_cols:
    if c in df.columns:
        df[c] = df[c].apply(clean_num)

# 仅保留前端需要的字段，忽略招募经纪人相关列
keep_cols = ['主播昵称', '主播id', '房间号', '开播分区', '运营经纪人', '运营经纪人UID',
             '主播在会时间', 'TOPSTAR等级', '主播等级分数', '粉丝数', '总流水（元）',
             '总收益（元）', '主播自提礼物收益', '语聊房嘉宾收益（元）', '专属互动礼物收益（元）',
             '新增粉丝数', '弹幕数', '开播天数', '开播时长（小时）', 'pk次数', 'pk流水',
             'pk付费人数', '违规次数', '峰值在线人数（pcu）', '平均在线人数（acu）', '付费人数',
             '大航海人数', '渠道来源', '年龄分层', '性别', '直播经验', '直播类型', '主播身份',
             '统计时间']

existing_cols = [c for c in keep_cols if c in df.columns]
df_out = df[existing_cols].copy()

df_out['主播id'] = df_out['主播id'].astype(str)
df_out['房间号'] = df_out['房间号'].astype(str)
df_out['运营经纪人UID'] = df_out['运营经纪人UID'].astype(str)

# 将 NaN / None 统一替换为空字符串或整数/浮点，避免生成非法 JSON (NaN)
def sanitize(v):
    if isinstance(v, float) and pd.isna(v):
        return ''
    if v is None:
        return ''
    if isinstance(v, float):
        if v.is_integer():
            return int(v)
    return v

records = []
for rec in df_out.to_dict(orient='records'):
    records.append({k: sanitize(v) for k, v in rec.items()})

# 校验统计时间中的日期数量
sample_dates = set()
for r in records:
    m = re.findall(r'(\d{4}-\d{2}-\d{2})', str(r.get('统计时间', '')))
    if m:
        sample_dates.add(m[0])

print(f"总记录数: {len(records)}")
print(f"统计日期数: {len(sample_dates)}, 示例: {sorted(sample_dates)[:7]}")

out_path = Path(r"E:\WorkBuddy\线下主播管理后台\streamer-dashboard\public\streamer_data.json")
out_path.parent.mkdir(parents=True, exist_ok=True)
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(records, f, ensure_ascii=False, indent=2, allow_nan=False)
print(f"已保存: {out_path}")
