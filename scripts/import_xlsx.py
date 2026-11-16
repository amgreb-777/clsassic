"""
Імпорт таблиці «Шаблон_меню.xlsx» → seed SQL для Supabase.

Використання:
    python3 scripts/import_xlsx.py path/to/Шаблон_меню.xlsx > supabase/seed.sql
    python3 scripts/import_xlsx.py path/to/Шаблон_меню.xlsx --json > seed.json   # JSON-варіант

Логіка таблиці, яку відтворює платформа:
  МенюЗамовлення : Назва блюда | Кількість | Вага 1 порції | Загальна вага
  Склад Блюд     : Назва блюда | Продукт | Брутто | Нетто   (на 1 порцію)
                   Кількість = VLOOKUP(блюдо, Меню); Разом = Брутто/Нетто × Кількість
  ЗАкупка        : зведена таблиця — SUM(Брутто), SUM(Нетто) по кожному продукту
  Довідник       : єдиний список назв продуктів
"""
import re
import sys
import warnings
from collections import OrderedDict

import openpyxl

warnings.filterwarnings("ignore")

# Продукти, які в «Склад Блюд» інколи записані в штуках (Брутто = шт, Нетто = грам)
COUNTABLE = {
    "томати чері", "яйця перепелині", "яйця курячі", "лимон", "лайм", "круасан",
    "бебі моцарелла", "рисовий папір", "цедра лимона",
}
LIQUID = {"ігристе"}

# Виправлення помилок у техкартах таблиці: (страва, продукт) → (брутто, нетто) на 1 порцію
CORRECTIONS = {
    ("Борщ Український", "Олія соняшникова"): (2, 2),  # у таблиці 20 г — це на 10 порцій
}

# Дублі назв у таблиці → основна назва продукту (об'єднано в базі 16.11.2026)
ALIASES = {
    "соевий соус": "Соєвий соус", "индичка": "Індичка", "крем сир": "Крем-сир",
    "соус кисло - солодкий": "Кисло-солодкий соус", "соус кисло-солодкий": "Кисло-солодкий соус",
    "соус горіховий": "Горіховий соус", "сир дор блю": "Дор Блю", "зелена цибуля": "Цибуля зелена",
    "крокети картопляні": "Картопляні крокети", "шампіньйони гриби": "Шампіньйони свіжі",
    "шампіньони свіжі": "Шампіньйони свіжі", "філе качки": "Філе качине", "оселедець філе": "Філе оселедця",
    "цукор пісок": "Цукор", "перець болгарський": "Перець солодкий", "яйця курячі": "Яйце куряче (шт)",
    "яйця перепелині": "Яйце перепелине (шт)", "томати чері": "Томати чері",
}


def clean(s):
    return re.sub(r"\s+", " ", str(s)).strip() if s is not None else None


def line_unit(product, gross, net):
    p = product.lower()
    if "(шт)" in p:
        return "шт"
    if p in LIQUID and gross < 10 and net >= gross * 100:
        return "л"
    if p in COUNTABLE and net > gross * 2:
        return "шт"
    return "г"


def category(name):
    n = name.lower()
    rules = [
        (("box", "шот box", "вох "), "Бокси та сети"),
        (("салат",), "Салати"),
        (("брускет",), "Брускети"),
        (("канапк", "тости", "міні-тост"), "Канапки та тости"),
        (("профітрол",), "Профітролі"),
        (("кіш", "тарт", "в тарті"), "Тарти та кіші"),
        (("млинц", "тісто на млинці"), "Млинці"),
        (("круасан", "бріош", "сендвіч"), "Сендвічі та круасани"),
        (("борщ", "бульйон", "крем-суп", "міністроне", "уха"), "Супи"),
        (("вафельний торт", "напалеон", "фруктові шашлички", "асорті фруктів"), "Десерти та фрукти"),
        (("^соус",), "Соуси"),
        (("картопл", "рис з овочами", "овочі-гриль", "гратен", "початки кукурудзи",
          "запечені овочі"), "Гарніри та овочі"),
        (("шашлик", "шашлички", "люля", "медальони", "каре ", "качина", "ребра", "крильця",
          "курка по", "куряче філе", "мітболи", "печеня", "плов", "філе ", "рулет із індички",
          "язик", "асорті ковбасок", "халумі", "креветки по", "креветки з ананасом"), "Гарячі страви"),
    ]
    for keys, cat in rules:
        if any(n.startswith(k[1:]) if k.startswith("^") else (n.startswith(k) or k in n) for k in keys):
            return cat
    return "Холодні закуски"


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def num(x):
    return "null" if x is None else repr(float(x)).rstrip("0").rstrip(".")


def main(path):
    wb = openpyxl.load_workbook(path)
    warn = []

    # --- Довідник продуктів
    canon = {}  # lower -> canonical name
    for r in range(2, wb["Довідник Продуктів"].max_row + 1):
        v = clean(wb["Довідник Продуктів"].cell(r, 1).value)
        if v:
            v = ALIASES.get(v.lower(), v)
            canon.setdefault(v.lower(), v)

    # --- Меню (страви + вага порції)
    dishes = OrderedDict()  # lower -> dict
    ws = wb["МенюЗамовлення"]
    for r in range(3, ws.max_row + 1):
        name = clean(ws.cell(r, 1).value)
        if not name:
            continue
        if name.lower() in dishes:
            warn.append(f"Дубль страви в меню: «{name}» (рядок {r}) — пропущено")
            continue
        dishes[name.lower()] = {"name": name, "portion": ws.cell(r, 3).value, "lines": OrderedDict()}

    # --- Склад страв
    ws = wb["Склад Блюд"]
    for r in range(2, ws.max_row + 1):
        d, p, g, n = (ws.cell(r, i).value for i in range(1, 5))
        d, p = clean(d), clean(p)
        if not d or not p:
            continue
        dish = dishes.get(d.lower())
        if dish is None:
            dish = dishes[d.lower()] = {"name": d, "portion": None, "lines": OrderedDict()}
            warn.append(f"Страва «{d}» є у складі, але відсутня в меню — додано")
        p = ALIASES.get(p.lower(), p)
        prod = canon.setdefault(p.lower(), p)
        g, n = float(g or 0), float(n or 0)
        if (dish["name"], prod) in CORRECTIONS:
            g, n = CORRECTIONS[(dish["name"], prod)]
        unit = line_unit(prod, g, n)
        key = (prod, unit)
        if key in dish["lines"]:
            og, on = dish["lines"][key]
            dish["lines"][key] = (og + g, on + n)
            warn.append(f"Повтор «{prod}» у страві «{dish['name']}» (рядок {r}) — об'єднано")
        else:
            dish["lines"][key] = (g, n)

    if "--json" in sys.argv:
        import json
        payload = {
            "products": sorted(canon.values(), key=str.lower),
            "dishes": [{"name": d["name"], "category": category(d["name"]), "portion": d["portion"]}
                       for d in dishes.values()],
            "lines": [{"dish": d["name"], "product": prod, "gross": g, "net": n, "unit": unit, "pos": pos}
                      for d in dishes.values()
                      for pos, ((prod, unit), (g, n)) in enumerate(d["lines"].items(), 1)],
        }
        print(json.dumps(payload, ensure_ascii=False))
        for w in warn:
            print("--", w, file=sys.stderr)
        return

    out = ["-- Згенеровано scripts/import_xlsx.py з «Шаблон_меню.xlsx»", "begin;"]
    out.append("insert into public.products (name) values")
    out.append(",\n".join(f"  ({q(v)})" for v in sorted(canon.values(), key=str.lower)))
    out.append("on conflict (name) do nothing;")

    out.append("insert into public.dishes (name, category, portion_weight_g) values")
    out.append(",\n".join(
        f"  ({q(d['name'])}, {q(category(d['name']))}, {num(d['portion'])})" for d in dishes.values()))
    out.append("on conflict (name) do update set category = excluded.category, portion_weight_g = excluded.portion_weight_g;")

    rows = []
    for d in dishes.values():
        for pos, ((prod, unit), (g, n)) in enumerate(d["lines"].items(), 1):
            rows.append(f"  ({q(d['name'])}, {q(prod)}, {num(g)}, {num(n)}, {q(unit)}, {pos})")
    out.append("insert into public.dish_ingredients (dish_id, product_id, gross, net, unit, position)")
    out.append("select d.id, p.id, v.gross, v.net, v.unit, v.pos from (values")
    out.append(",\n".join(rows))
    out.append(") as v(dish, product, gross, net, unit, pos)")
    out.append("join public.dishes d on d.name = v.dish join public.products p on p.name = v.product")
    out.append("on conflict (dish_id, product_id, unit) do update set gross = excluded.gross, net = excluded.net, position = excluded.position;")
    out.append("commit;")
    print("\n".join(out))
    for w in warn:
        print("--", w, file=sys.stderr)
    print(f"-- products={len(canon)} dishes={len(dishes)} lines={len(rows)}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
