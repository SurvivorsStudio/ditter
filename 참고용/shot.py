from playwright.sync_api import sync_playwright
import sys
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={"width":1280,"height":800})
    pg.goto("file:///sessions/sharp-beautiful-galileo/mnt/outputs/EAI_UI_%EB%AA%A9%EC%97%85.html")
    pg.wait_for_timeout(500)
    for v,btn in [("home",0),("canvas",1),("monitor",2),("conn",3)]:
        pg.evaluate(f"document.querySelectorAll('#nav button')[{btn}].click()")
        pg.wait_for_timeout(300)
        pg.screenshot(path=f"shot_{v}.png")
    b.close()
print("shots done")
