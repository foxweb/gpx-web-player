"use client"

import { Button } from "@/components/ui/button"

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-start gap-3 px-6 py-16">
      <h1 className="text-xl font-semibold">Что-то пошло не так</h1>
      <p className="text-sm text-muted-foreground">
        Страница не открылась. Попробуйте ещё раз — выбранный файл при этом
        придётся открыть заново.
      </p>
      <Button onClick={() => reset()}>Попробовать снова</Button>
    </main>
  )
}
