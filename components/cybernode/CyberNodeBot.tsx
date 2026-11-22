"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, CheckCircle2, X as XIcon, Copy, ClipboardPaste, FileText, Trash2, Loader2, Plus, Paperclip, Send, Check } from "lucide-react";

type BotMode = "admin" | "user";

interface BotState {
  name: string | null;
  mode: BotMode;
  showWelcomeDialog: boolean;
  showProblemSolver: boolean;
  problemSolverMode: string | null;
  loadingProblemSolver: boolean;
  messages: Array<{ role: string; content: string }>;
}

const DEFAULT_ADMIN_NAME = "Director Kansas Nelly";
const BOT_NAME_STORAGE_KEY = "cybernode_bot_name";

const getUserConfig = () => {
  return {
    welcomeMessage: "Welcome, user",
    isAdmin: false,
  };
};

const renderWelcomeMessage = (state: BotState) => {
  if (state.name) {
    return (
      <div className="cyber-welcome-message">
        Alright {state.name.startsWith("Mr.") || state.name.startsWith("Ms.") || state.name.startsWith("Dr.") ? state.name : state.name}. Let me know how I can help you today.
      </div>
    );
  }
  return (
    <div className="cyber-welcome-message">
      {state.mode === "admin" ? "Welcome, Executive" : "Welcome, user. Please enter your name for a personalized experience."}
    </div>
  );
};

const renderProblemSolver = (state: BotState, setState: React.Dispatch<React.SetStateAction<BotState>>) => {
  if (state.problemSolverMode) {
    return (
      <div className="problem-solver-modes">
        <div className="mode-selector">
          <button className="mode-mode-button" onClick={() => setState((prev) => ({ ...prev, problemSolverMode: "Architect" }))}>Architect</button>
          <button className="mode-mode-button" onClick={() => setState((prev) => ({ ...prev, problemSolverMode: "Debugger" }))}>Debugger</button>
          <button className="mode-mode-button" onClick={() => setState((prev) => ({ ...prev, problemSolverMode: "Monetization" }))}>Monetization</button>
          <button className="mode-mode-button" onClick={() => setState((prev) => ({ ...prev, problemSolverMode: "General Q&A" }))}>General Q&A</button>
        </div>
        <div className="help-description">
          Ask questions about any aspect of the platform, get clear step-by-step guidance, or explain complex features. The bot will respond with structured explanations and practical examples.
        </div>
      </div>
    );
  }
  return null;
};

const CyberNodeBot = ({ mode }: { mode: BotMode }) => {
  const [state, setState] = useState<BotState>({
    name: null,
    mode,
    showWelcomeDialog: true,
    showProblemSolver: false,
    problemSolverMode: null,
    loadingProblemSolver: false,
    messages: [],
  });
  const [nameDraft, setNameDraft] = useState("");
  const [scratchpad, setScratchpad] = useState("");
  const [isScratchpadEditing, setIsScratchpadEditing] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [pendingApply, setPendingApply] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleScratchpadChange = (value: string) => {
    setScratchpad(value);
    if (!isScratchpadEditing) setIsScratchpadEditing(true);
  };

  const handleToggleScratchpadEdit = () => {
    setIsScratchpadEditing((prev) => !prev);
  };

  const handleCopyScratchpad = async () => {
    try {
      await navigator.clipboard.writeText(scratchpad);
      return true;
    } catch {
      return false;
    }
  };

  const handlePasteScratchpad = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setScratchpad((prev) => (prev ? `${prev}\n${text}` : text));
        setIsScratchpadEditing(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleFileUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    setScratchpad((prev) => (prev ? `${prev}\n${text}` : text));
    setIsScratchpadEditing(true);
  };

  const handleApplyScratchpad = (text: string) => {
    setPendingApply(text);
    setShowApplyConfirm(true);
  };

  const handleConfirmApply = async () => {
    const text = pendingApply;
    if (!text?.trim()) {
      setShowApplyConfirm(false);
      return;
    }
    setIsApplying(true);
    setShowApplyConfirm(false);
    try {
      const response = await fetch("/api/owner-vault/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gemini",
          messages: [{ role: "user", content: `Apply this planned change to the CyberNode codebase carefully and safely:\n\n${text}` }],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        // The assistant applied the change; surface success state.
        setScratchpad("");
        setIsScratchpadEditing(false);
      } else {
        throw new Error(body?.error ?? "The assistant could not apply the change.");
      }
    } catch (error) {
      // Keep scratchpad content so user can retry after fixing the request.
      console.error("Apply scratchpad error:", error);
    } finally {
      setIsApplying(false);
      setPendingApply(null);
    }
  };

  const handleDiscardScratchpad = () => {
    setScratchpad("");
    setIsScratchpadEditing(false);
    setShowApplyConfirm(false);
    setPendingApply(null);
  };

  // Keep the bot mode aligned with the current dashboard role.
  useEffect(() => {
    setState((prev) => ({ ...prev, mode }));
  }, [mode]);

  // Load saved name on mount
  useEffect(() => {
    const storedName = localStorage.getItem(BOT_NAME_STORAGE_KEY);
    if (storedName) {
      setNameDraft(storedName);
      setState((prev) => ({ ...prev, name: storedName, showWelcomeDialog: false }));
    }
  }, []);

  const persistName = (raw: string, closeDialog: boolean) => {
    const name = raw.trim();
    if (!name) return;
    localStorage.setItem(BOT_NAME_STORAGE_KEY, name);
    setNameDraft(name);
    setState((prev) => ({ ...prev, name, showWelcomeDialog: closeDialog ? false : prev.showWelcomeDialog }));
  };

  const handleNameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNameDraft(e.target.value);
  };

  const handleNameBlur = () => {
    persistName(nameDraft, false);
  };

  const handleNameSubmit = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    persistName(nameDraft, true);
  };

  const handleReset = () => {
    setState((prev) => ({ ...prev, showWelcomeDialog: true, showProblemSolver: false, problemSolverMode: null }));
  };

  const getAdminConfig = () => {
    return {
      welcomeMessage: "Welcome, Executive",
      mode: "admin" as BotMode,
      isAdmin: true,
      stakingEnginesCount: 0,
      maxBoostBps: 120000,
      treasuryAnchorAddress: "UQDrrGsThCAJrPj6QbUueKJyh8QOQrBZwHSm1C6E_UahK5Ok",
      depositAddress: "UQBLz9rXlNtlzVUMuUHosRBTpUWqfoXQ8WTkyAgtbSVlbnBJ",
      liquidityReady: true,
    };
  };

  const getProblemSolverConfig = () => {
    return {
      welcomeMessage: "Welcome to the CyberNode Problem Solver",
      isAdmin: false,
    };
  };

  const getAdminDiagnostics = (config: any) => {
    const diagnostics = [
      `Staking engines: ${config.stakingEnginesCount}/5`,
      `Max boost: ${config.maxBoostBps / 10000}x (120000 bps)`,
      `Liquidity: ${config.liquidityReady ? "✓ Ready" : "✗ Unavailable"}`,
      `Deposit address: ${config.depositAddress}`,
    ];
    return diagnostics;
  };

  const handleProblemSolverSubmit = async (question: string) => {
    setState((prev) => ({ ...prev, loadingProblemSolver: true }));
    try {
      const response = await fetch("/api/owner-vault/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: state.problemSolverMode === "Architect" ? "openrouter" : "gemini",
          messages: [{ role: "user", content: question }],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get assistant response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let content = "";
      while (reader?.read()) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
      }

      setState((prev) => ({ ...prev, loadingProblemSolver: false }));
      if (content.trim()) {
        const newMessages = [...state.messages, { role: "assistant", content }];
        setState((prev) => ({ ...prev, messages: newMessages }));
      }
    } catch (error) {
      setState((prev) => ({ ...prev, loadingProblemSolver: false }));
      console.error("Problem solver error:", error);
    }
  };

  const renderAdminMode = () => {
    const config = getAdminConfig();
    return (
      <div className="cyber-node-bot">
        <header className="cyber-node-header">
          <div className="cyber-node-mode-badge">
            <ShieldCheck size={14} className="mr-2" />
            <span className="mode-badge admin">Admin Mode</span>
            <span>Director Kansas Nelly</span>
          </div>
          <button className="cyber-node-reset-btn" onClick={handleReset}>
            <XIcon size={12} /> Reset
          </button>
        </header>
        <section className="cyber-node-diagnostics">
          {getAdminDiagnostics(config).map((diagnostic, i) => (
            <div key={i} className="diagnostic-item">
              {i === 0 ? <ShieldCheck size={14} /> : <CheckCircle2 size={14} />}
              <span>{diagnostic}</span>
            </div>
          ))}
        </section>
      </div>
    );
  };

  const renderUserMode = () => {
    const config = getUserConfig();
    const compactAssistant = state.problemSolverMode === "Architect" || state.problemSolverMode === "Debugger";
    return (
      <div className="cyber-node-bot">
        <header className="cyber-node-header">
          <div className="cyber-node-mode-badge">
            <ShieldCheck size={14} className="mr-2" />
            <span className="mode-badge user">User Mode</span>
            <span>Regular User</span>
          </div>
          <button className="cyber-node-reset-btn" onClick={handleReset}>
            <XIcon size={12} /> Reset
          </button>
        </header>
        <section className="cyber-node-help">
          {compactAssistant && (
            <div className="assistant-compact">
              <div className="assistant-compact-head">
                <span className="eyebrow">MINI-ASSISTANT</span>
                <div className="assistant-compact-actions">
                  <button type="button" className="assistant-mini-btn" onClick={handleToggleScratchpadEdit} title="Toggle notes scratchpad editor">
                    {isScratchpadEditing ? <Check size={12} /> : <FileText size={12} />} Edit notes
                  </button>
                  <button type="button" className="assistant-mini-btn" onClick={handleCopyScratchpad} title="Copy notes to clipboard">
                    <Copy size={12} /> Copy
                  </button>
                  <button type="button" className="assistant-mini-btn" onClick={() => fileInputRef.current?.click()} title="Upload a file into the notes scratchpad">
                    <Paperclip size={12} /> Upload
                  </button>
                  <button type="button" className="assistant-mini-btn" onClick={handlePasteScratchpad} title="Paste from clipboard into notes scratchpad">
                    <ClipboardPaste size={12} /> Paste
                  </button>
                  <button type="button" className="assistant-mini-btn assistant-mini-apply" onClick={() => handleApplyScratchpad(scratchpad)} disabled={!scratchpad.trim() || isApplying}>
                    <Plus size={12} /> Apply
                  </button>
                  <button type="button" className="assistant-mini-btn" onClick={handleDiscardScratchpad} disabled={!scratchpad}>
                    <Trash2 size={12} /> Discard
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    onChange={handleFileUploadChange}
                    accept="text/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.css,.html,.py"
                  />
                </div>
              </div>
              {isScratchpadEditing ? (
                <textarea
                  className="assistant-scratchpad"
                  value={scratchpad}
                  onChange={(event) => handleScratchpadChange(event.target.value)}
                  placeholder="Paste notes or code here. This is read-only context for the assistant until you apply it."
                  rows={6}
                  aria-label="User mode notes scratchpad"
                />
              ) : (
                <div className="assistant-scratchpad assistant-scratchpad-readonly" onClick={handleToggleScratchpadEdit}>
                  {scratchpad ? scratchpad : <span className="muted-copy">No notes yet — tap "Edit notes" to add context.</span>}
                </div>
              )}
            </div>
          )}
          {renderProblemSolver(state, setState)}
        </section>
        {showApplyConfirm && pendingApply !== null && (
          <div className="cyber-apply-confirm" role="dialog" aria-modal="true">
            <div className="cyber-apply-confirm-card">
              <span className="eyebrow">SAFEGUARD CONFIRMATION</span>
              <h4>Apply this planned change?</h4>
              <p className="muted-copy">
                The assistant will review the following proposed change and apply it carefully while respecting existing rate limits and leaving the core reward math untouched.
              </p>
              <pre className="mono cyber-apply-preview">{pendingApply}</pre>
              <div className="cyber-apply-actions">
                <button type="button" className="mining-primary" onClick={handleConfirmApply} disabled={isApplying}>
                  {isApplying ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Confirm &amp; apply
                </button>
                <button type="button" className="assistant-mini-btn" onClick={handleDiscardScratchpad} disabled={isApplying}>
                  <XIcon size={12} /> Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderWelcomeDialog = () => {
    return (
      <div className="cyber-welcome-dialog">
        {renderWelcomeMessage(state)}
        <div className="cyber-name-input">
          <input
            type="text"
            name="botName"
            placeholder="Enter your name"
            value={nameDraft}
            onChange={handleNameInputChange}
            onBlur={handleNameBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                persistName(nameDraft, true);
              }
            }}
            className="input-field"
            autoComplete="off"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="submit-btn" onClick={handleNameSubmit} type="button">
            Save Name
          </button>
        </div>
        <button className="reset-btn" onClick={handleReset} type="button">
          <XIcon size={12} /> Reset
        </button>
      </div>
    );
  };

  if (state.showWelcomeDialog) {
    return renderWelcomeDialog();
  }

  if (state.mode === "admin") {
    return renderAdminMode();
  }

  if (state.mode === "user") {
    return renderUserMode();
  }

  return null;
};

export default CyberNodeBot;