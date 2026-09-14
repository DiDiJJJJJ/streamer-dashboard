import pandas as pd
file = r"C:\Users\Administrator\Desktop\线下主播看板\主播数据_2026-08-08 14_05_45.xlsx"
df = pd.read_excel(file, sheet_name='主播数据')
df['开播天数'] = df['开播天数'].astype(str).str.replace('天', '', regex=False)
df['开播天数'] = pd.to_numeric(df['开播天数'], errors='coerce').fillna(0)
print("开播天数 非空(>0)数:", int((df['开播天数'] > 0).sum()))
print("开播天数 最大值:", int(df['开播天数'].max()), " 最小值:", int(df['开播天数'].min()))
print("含'天'原始值样本:", df['开播天数'].unique()[:8])
