"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle2, X as XIcon } from "lucide-react";

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

  // Load saved name on mount
  useEffect(() => {
    const storedName = localStorage.getItem(BOT_NAME_STORAGE_KEY);
    if (storedName) {
      setState((prev) => ({ ...prev, name: storedName, showWelcomeDialog: false }));
    }
  }, []);

  const loadName = () => {
    const stored = localStorage.getItem(BOT_NAME_STORAGE_KEY);
    if (stored) {
      setState((prev) => ({ ...prev, name: stored, showWelcomeDialog: false }));
    }
  };

  const handleNameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value.trim();
    if (name) {
      localStorage.setItem(BOT_NAME_STORAGE_KEY, name);
      setState((prev) => ({ ...prev, name, showWelcomeDialog: false }));
    }
  };

  const handleNameSubmit = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const input = document.querySelector<HTMLInputElement>('input[name="botName"]');
    const name = input?.value.trim();
    if (name) {
      localStorage.setItem(BOT_NAME_STORAGE_KEY, name);
      setState((prev) => ({ ...prev, name, showWelcomeDialog: false }));
    }
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
          {renderProblemSolver(state, setState)}
        </section>
      </div>
    );
  };

  const renderWelcomeDialog = () => {
    return (
      <div className="cyber-welcome-dialog">
        <div className="cyber-welcome-message">
          {renderWelcomeMessage(state)}
        </div>
        {state.name ? (
          <div className="cyber-name-input">
            <input
              type="text"
              name="botName"
              placeholder="Enter your name"
              value={state.name || ""}
              onChange={(e) => {
                const name = e.target.value.trim();
                if (name) {
                  localStorage.setItem(BOT_NAME_STORAGE_KEY, name);
                  setState((prev) => ({ ...prev, name, showWelcomeDialog: false }));
                }
              }}
              className="input-field"
            />
            <button className="submit-btn" onClick={handleNameSubmit}>
              Save Name
            </button>
          </div>
        ) : (
          <div className="cyber-name-input">
            <input
              type="text"
              name="botName"
              placeholder="Enter your name"
              onChange={handleNameInputChange}
              className="input-field"
            />
          </div>
        )}
        <button className="reset-btn" onClick={handleReset}>
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