"use client";

import { useEffect } from "react";

// Error boundaries are client components and cannot read the server dictionary, so this one
// reads the language from <html lang> and carries both strings.
const TEXT = {
  en: {
    title: "Something went wrong",
    help: "The page could not be loaded. Your changes were not lost; try again in a moment.",
    retry: "Try again",
  },
  ja: {
    title: "問題が発生しました",
    help: "ページを読み込めませんでした。変更内容は失われていません。しばらくしてからもう一度お試しください。",
    retry: "再試行",
  },
};

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const t =
    typeof document !== "undefined" && document.documentElement.lang === "ja" ? TEXT.ja : TEXT.en;

  return (
    <div role="alert" className="py-16 text-center">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-zinc-600">{t.help}</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-zinc-400">ref {error.digest}</p>}
      <button onClick={reset} className="mt-4 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
        {t.retry}
      </button>
    </div>
  );
}
