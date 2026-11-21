/**
 * Shareable Organic Referral / Update Note Generator.
 * Creates copy-ready summaries for user-initiated sharing (not unsolicited spam).
 * Integrates with Telegram digest dispatcher for server-tracked logging.
 */

import { formatEventMessage, type TelegramEventType } from "./telegram-dispatcher"
import { dispatchTelegramDigest } from "./telegram-dispatcher"
import { formatAtomic } from "@/lib/mining/config"
import { tonviewerAddressUrl, tonviewerTransactionUrl } from "@/lib/mining/config"

type ShareableReceipt = {
  userId: string
  walletAddress: string
  assetCode: string
  amountAtomic: string
  transactionHash: string
  tonviewerUrl: string
  referralUrl: string
  message: string
  timestamp: string
}

export function createShareableReceipt(
  userId: string,
  walletAddress: string,
  assetCode: string,
  amountAtomic: string,
  transactionHash: string,
  tonviewerUrl: string,
  referralUrl: string,
  timestamp: string
): ShareableReceipt {
  const message = `🎉 Reward Claim!
  
  Asset: ${assetCode}
  Amount: ${formatAtomic(amountAtomic, 6)}
  Transaction: ${transactionHash}
  
  View on Tonviewer: ${tonviewerUrl}
  Share this note to earn organic rewards!
  
  Referral: ${referralUrl}
  Timestamp: ${timestamp}
  ` 
  return {
    userId,
    walletAddress,
    assetCode,
    amountAtomic,
    transactionHash,
    tonviewerUrl,
    referralUrl,
    message,
    timestamp,
  }
}

// Helper to generate referral URL
export function generateReferralUrl(userId: string, assetCode: string, amountAtomic: string): string {
  const params = new URLSearchParams()
  params.set("user_id", userId)
  params.set("asset", assetCode)
  params.set("amount", amountAtomic)
  return `${process.env.NEXT_PUBLIC_SITE_URL}/referral?${params.toString()}`
}

// Helper to log event and dispatch Telegram digest
export async function logAndNotifyEvent(
  eventType: string,
  payload: Record<string, unknown>,
  message: string,
  referralUrl: string,
  walletAddress: string,
  userId: string
): Promise<void> {
  // Log event
  await dispatchTelegramDigest([
    {
      chatId: "self",
      text: formatEventMessage(eventType as TelegramEventType, payload),
      parseMode: "HTML",
    },
  ])
  
  // Create and share receipt
  const timestamp = new Date().toISOString()
  const receipt = createShareableReceipt(
    userId,
    walletAddress,
    eventType === "withdrawal_broadcast" ? "TON" : "GRAM",
    "0", // placeholder, will be updated in main flow
    "0", // placeholder, will be updated in main flow
    "https://tonviewer.com/placeholder",
    referralUrl,
    timestamp
  )
  
  // In real implementation, this would be sent to server for logging
  console.log("Shareable receipt created:", receipt)
}