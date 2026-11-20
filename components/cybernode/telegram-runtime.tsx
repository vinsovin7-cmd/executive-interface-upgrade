"use client"

import { useEffect } from "react"

export function TelegramRuntime() {
  useEffect(() => {
    window.Telegram?.WebApp?.ready()
  }, [])

  return null
}
