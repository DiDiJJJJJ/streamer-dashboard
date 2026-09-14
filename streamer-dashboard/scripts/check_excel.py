import pandas as pd
file = r"C:\Users\Administrator\Desktop\线下主播看板\主播数据_2026-08-08 14_05_45.xlsx"
df = pd.read_excel(file, sheet_name='主播数据')
print("全部列名:")
for c in df.columns:
    print(" -", repr(c))
print("\n含'开播'的列:", [c for c in df.columns if '开播' in str(c)])
print("\n含'天数'的列:", [c for c in df.columns if '天数' in str(c)])
for c in df.columns:
    cs = str(c)
    if '开播天数' in cs or '天数' in cs:
        col = df[c]
        print(f"\n列 [{c}] 非空数:", int(col.notna().sum()), " 唯一值样本:", col.dropna().unique()[:10])
        print("  类型:", col.dtype)
