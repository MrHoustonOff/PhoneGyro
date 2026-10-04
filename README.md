# PhoneGyro: лендинг

Статический сайт без сборки и зависимостей. Откройте `index.html` через любой веб-сервер (например, `python -m http.server`) или просто выложите папку на хостинг.

## Что внутри

- `index.html` — вся страница. Русский и английский тексты лежат в одном HTML, поэтому поисковики видят оба. Язык выбирается по языку браузера, переключатель RU/EN запоминает выбор. Можно открыть сразу английскую версию: `/?lang=en`.
- `landing.css`, `site.js`, `scene.js` — стили и скрипты страницы. `scene.js` содержит 3D-сцены и анимации прокрутки (отключаются на телефонах и при «уменьшить движение»).
- `three.min.js` (Three.js r128), `gamepad-data.js` (3D-модель геймпада, встроена, отдельных запросов нет), `ds/phonegyro/` — дизайн-система и шрифты.
- SEO: заголовок и описание, canonical, hreflang, Open Graph и Twitter-карточка (`og-image.png`), разметка JSON-LD (SoftwareApplication, WebSite, FAQPage), `robots.txt`, `sitemap.xml`, `favicon.svg`, `site.webmanifest`, `404.html`.
- `.nojekyll` (нужен для GitHub Pages), `_headers` (кэш и заголовки для Cloudflare Pages / Netlify).

## Перед публикацией

1. **Укажите свой адрес.** Сейчас везде стоит `https://mrhoustonoff.github.io/PhoneGyro/`. Если сайт будет по другому адресу, замените его в `index.html`, `sitemap.xml`, `robots.txt`:

   ```
   grep -rl "mrhoustonoff.github.io/PhoneGyro/" . | xargs sed -i 's#https://mrhoustonoff.github.io/PhoneGyro/#https://ВАШ-АДРЕС/#g'
   ```

2. **Ссылка «Контракт устройства»** (карточка про собственное USB-устройство) ведёт на `…/guide/diy-controller`. Это заглушка: замените на реальную страницу или уберите кнопку.
3. **Кнопка «Скачать для Windows»** ведёт на `https://github.com/MrHoustonOff/PhoneGyro/releases/latest` и всегда открывает последний релиз. Чтобы файл качался сразу, подставьте прямую ссылку на asset.
4. Если документация (VitePress) живёт на том же домене под `/guide/`, положите её сборку в подпапку `guide/`, а этот лендинг оставьте в корне.

## Хостинг (любой подойдёт)

- **GitHub Pages:** положите содержимое папки в ветку или папку `/docs` и включите Pages в настройках репозитория.
- **Cloudflare Pages или Netlify:** создайте проект, укажите папку как есть, команду сборки оставьте пустой.

## Продвижение

1. Добавьте сайт в [Google Search Console](https://search.google.com/search-console) и [Яндекс Вебмастер](https://webmaster.yandex.ru), отправьте `sitemap.xml` и запросите индексацию главной.
2. В репозитории на GitHub заполните About: ссылка на сайт, описание и темы (`gyroscope`, `dsu`, `cemuhook`, `motion-controls`, `emulator`). Добавьте ссылку на сайт в начало README репозитория.
3. Соберите внешние ссылки: страницы в списках Cemuhook/DSU-клиентов, тема на профильных форумах и сообществах эмуляторов, видео с обзором.
4. После публикации проверьте превью ссылки и разметку: [Rich Results Test](https://search.google.com/test/rich-results), [Open Graph Debugger](https://opengraph.dev).

## Осторожно с упоминаниями Nintendo

В тексте остаются названия эмуляторов и одна игра в FAQ. Логотипов и материалов Nintendo на сайте нет, в подвале есть оговорка, что проект не связан с Nintendo. Это не юридическая консультация: если захотите перестраховаться, уберите названия игр и консолей из FAQ и описаний.
