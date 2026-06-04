export type Locale = "en" | "ko" | "ja" | "zh-Hans";

type Dict = Record<string, string>;

const DICT: Record<Locale, Dict> = {
  en: {
    "doc.untitled": "Untitled",
    "theme.toggle": "Theme",
    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.theme": "Theme",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "status.words": "{n} words",
    "status.lineCol": "Ln {line}, Col {col}",
    "status.autosave": "Auto Save",
    "confirm.discardOpen": "You have unsaved changes. Discard and open?",
    "confirm.closeDirty": "You have unsaved changes. Close anyway?",
    "palette.placeholder": "Command or file…",
    "search.placeholder": "Search workspace…",
    "search.empty": "No results",
    "search.noFolder": "Open a folder first (Ctrl/Cmd-Shift-O)",
    "conflict.msg": "This file changed on disk.",
    "conflict.reload": "Load disk version",
    "conflict.keep": "Keep my changes",
    "image.saveFirst": "Save the document first to insert an image (Ctrl/Cmd-S).",
    "tree.workspace": "Workspace",
    "cmd.newTab": "New tab",
    "cmd.openFile": "Open file…",
    "cmd.openFolder": "Open folder…",
    "cmd.save": "Save",
    "cmd.toggleTheme": "Toggle theme",
    "cmd.closeTab": "Close tab",
    "cmd.search": "Search",
    "cmd.exportHtml": "Export to HTML",
    "cmd.exportPdf": "Export to PDF",
    "cmd.language": "Language",
    "error.mermaid": "Mermaid error: {msg}",
  },
  ko: {
    "doc.untitled": "제목 없음",
    "theme.toggle": "테마",
    "settings.title": "설정",
    "settings.language": "언어",
    "settings.theme": "테마",
    "theme.light": "라이트",
    "theme.dark": "다크",
    "status.words": "{n} 단어",
    "status.lineCol": "줄 {line}, 열 {col}",
    "status.autosave": "자동 저장",
    "confirm.discardOpen": "저장하지 않은 변경이 있습니다. 버리고 열까요?",
    "confirm.closeDirty": "저장하지 않은 변경이 있습니다. 닫을까요?",
    "palette.placeholder": "명령 또는 파일…",
    "search.placeholder": "워크스페이스 검색…",
    "search.empty": "결과 없음",
    "search.noFolder": "폴더를 먼저 여세요 (Ctrl/Cmd-Shift-O)",
    "conflict.msg": "이 파일이 디스크에서 변경되었습니다.",
    "conflict.reload": "디스크 버전 불러오기",
    "conflict.keep": "내 변경 유지",
    "image.saveFirst": "이미지를 넣으려면 먼저 문서를 저장하세요 (Ctrl/Cmd-S).",
    "tree.workspace": "워크스페이스",
    "cmd.newTab": "새 탭",
    "cmd.openFile": "파일 열기…",
    "cmd.openFolder": "폴더 열기…",
    "cmd.save": "저장",
    "cmd.toggleTheme": "테마 전환",
    "cmd.closeTab": "탭 닫기",
    "cmd.search": "검색",
    "cmd.exportHtml": "HTML로 내보내기",
    "cmd.exportPdf": "PDF로 내보내기",
    "cmd.language": "언어",
    "error.mermaid": "Mermaid 오류: {msg}",
  },
  ja: {
    "doc.untitled": "無題",
    "theme.toggle": "テーマ",
    "settings.title": "設定",
    "settings.language": "言語",
    "settings.theme": "テーマ",
    "theme.light": "ライト",
    "theme.dark": "ダーク",
    "status.words": "{n} 単語",
    "status.lineCol": "{line} 行, {col} 列",
    "status.autosave": "自動保存",
    "confirm.discardOpen": "保存していない変更があります。破棄して開きますか？",
    "confirm.closeDirty": "保存していない変更があります。閉じますか？",
    "palette.placeholder": "コマンドまたはファイル…",
    "search.placeholder": "ワークスペースを検索…",
    "search.empty": "結果なし",
    "search.noFolder": "先にフォルダーを開いてください (Ctrl/Cmd-Shift-O)",
    "conflict.msg": "このファイルはディスク上で変更されました。",
    "conflict.reload": "ディスクの版を読み込む",
    "conflict.keep": "自分の変更を保持",
    "image.saveFirst": "画像を挿入するには先にドキュメントを保存してください (Ctrl/Cmd-S)。",
    "tree.workspace": "ワークスペース",
    "cmd.newTab": "新しいタブ",
    "cmd.openFile": "ファイルを開く…",
    "cmd.openFolder": "フォルダーを開く…",
    "cmd.save": "保存",
    "cmd.toggleTheme": "テーマを切り替え",
    "cmd.closeTab": "タブを閉じる",
    "cmd.search": "検索",
    "cmd.exportHtml": "HTML にエクスポート",
    "cmd.exportPdf": "PDF にエクスポート",
    "cmd.language": "言語",
    "error.mermaid": "Mermaid エラー: {msg}",
  },
  "zh-Hans": {
    "doc.untitled": "无标题",
    "theme.toggle": "主题",
    "settings.title": "设置",
    "settings.language": "语言",
    "settings.theme": "主题",
    "theme.light": "浅色",
    "theme.dark": "深色",
    "status.words": "{n} 词",
    "status.lineCol": "第 {line} 行, 第 {col} 列",
    "status.autosave": "自动保存",
    "confirm.discardOpen": "有未保存的更改。放弃并打开？",
    "confirm.closeDirty": "有未保存的更改。仍要关闭？",
    "palette.placeholder": "命令或文件…",
    "search.placeholder": "搜索工作区…",
    "search.empty": "无结果",
    "search.noFolder": "请先打开文件夹 (Ctrl/Cmd-Shift-O)",
    "conflict.msg": "此文件已在磁盘上更改。",
    "conflict.reload": "加载磁盘版本",
    "conflict.keep": "保留我的更改",
    "image.saveFirst": "插入图片前请先保存文档 (Ctrl/Cmd-S)。",
    "tree.workspace": "工作区",
    "cmd.newTab": "新建标签页",
    "cmd.openFile": "打开文件…",
    "cmd.openFolder": "打开文件夹…",
    "cmd.save": "保存",
    "cmd.toggleTheme": "切换主题",
    "cmd.closeTab": "关闭标签页",
    "cmd.search": "搜索",
    "cmd.exportHtml": "导出为 HTML",
    "cmd.exportPdf": "导出为 PDF",
    "cmd.language": "语言",
    "error.mermaid": "Mermaid 错误: {msg}",
  },
};

let current: Locale = "en";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
  { code: "zh-Hans", label: "简体中文" },
];

export function setLocale(l: Locale): void { current = l; }
export function getLocale(): Locale { return current; }

/** Map one BCP-47 tag (e.g. "ko-KR", "zh-Hant-TW") to a supported Locale, or null. */
function matchLocale(tag: string): Locale | null {
  const l = (tag || "").toLowerCase();
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("zh")) return "zh-Hans"; // only Simplified ships; any Chinese → it
  if (l.startsWith("en")) return "en";
  return null;
}

/** Best-effort guess from the OS/browser preference list, used only as the
 *  default selection in the first-run picker. Walks navigator.languages in
 *  order and returns the first supported locale; falls back to English so the
 *  app never silently lands on a CJK locale the user never chose. */
export function detectLocale(): Locale {
  const list: string[] =
    typeof navigator !== "undefined"
      ? (navigator.languages && navigator.languages.length
          ? Array.from(navigator.languages)
          : [navigator.language])
      : [];
  for (const tag of list) {
    const m = matchLocale(tag);
    if (m) return m;
  }
  return "en";
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICT[current][key] ?? DICT.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}
