/* oxlint-disable react/only-export-components -- auth context intentionally colocates its hook and provider */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { Navigate, useLocation } from "react-router-dom";
import { configureTokenProvider } from "./api";
import {
  cognitoClientId,
  cognitoUserPoolId,
  mockAuthEnabled,
} from "./config";
import { useI18n } from "./i18n";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}
interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mode: "mock" | "cognito";
  signIn(identifier: string, password: string): Promise<void>;
  signUp(identifier: string, password: string): Promise<boolean>;
  confirmSignUp(identifier: string, code: string): Promise<void>;
  signOut(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const pool =
  !mockAuthEnabled && cognitoUserPoolId && cognitoClientId
    ? new CognitoUserPool({
        UserPoolId: cognitoUserPoolId,
        ClientId: cognitoClientId,
      })
    : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (mockAuthEnabled) {
      const stored = localStorage.getItem("dadhep.mock-user");
      if (stored) setUser(JSON.parse(stored));
      setLoading(false);
      return;
    }
    const current = pool?.getCurrentUser();
    if (!current) return setLoading(false);
    current.getSession(
      (error: Error | null, session: CognitoUserSession | null) => {
        if (!error && session?.isValid()) {
          const claims = session.getIdToken().payload;
          setUser({
            id: claims.sub,
            email: claims.email || current.getUsername(),
            name: claims.name,
          });
        }
        setLoading(false);
      },
    );
  }, []);

  async function signIn(email: string, password: string) {
    if (mockAuthEnabled) {
      if (!email || !password) throw new Error("Enter an email and password");
      const next = { id: "local-user", email, name: email.split("@")[0] };
      localStorage.setItem("dadhep.mock-user", JSON.stringify(next));
      setUser(next);
      return;
    }
    if (!pool)
      throw new Error(
        "Cognito is not configured. Set the VITE_COGNITO_* environment variables.",
      );
    await new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.authenticateUser(
        new AuthenticationDetails({ Username: email, Password: password }),
        {
          onSuccess(session) {
            const claims = session.getIdToken().payload;
            setUser({
              id: claims.sub,
              email: claims.email || email,
              name: claims.name,
            });
            resolve();
          },
          onFailure: reject,
          newPasswordRequired: () =>
            reject(
              new Error(
                "A new password is required. Complete the password change in Cognito.",
              ),
            ),
        },
      );
    });
  }

  async function signUp(identifier: string, password: string) {
    if (mockAuthEnabled) {
      await signIn(identifier, password);
      return false;
    }
    if (!pool)
      throw new Error(
        "Cognito is not configured. Set the VITE_COGNITO_* environment variables.",
      );
    const attributeName = identifier.includes("@") ? "email" : "phone_number";
    return new Promise<boolean>((resolve, reject) => {
      pool.signUp(
        identifier,
        password,
        [new CognitoUserAttribute({ Name: attributeName, Value: identifier })],
        [],
        (error, result) =>
          error
            ? reject(error)
            : resolve(Boolean(result?.userConfirmed === false)),
      );
    });
  }

  async function confirmSignUp(identifier: string, code: string) {
    if (mockAuthEnabled) return;
    if (!pool) throw new Error("Cognito is not configured.");
    await new Promise<void>((resolve, reject) => {
      new CognitoUser({ Username: identifier, Pool: pool }).confirmRegistration(
        code,
        true,
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  function signOut() {
    localStorage.removeItem("dadhep.mock-user");
    pool?.getCurrentUser()?.signOut();
    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn,
      signUp,
      confirmSignUp,
      signOut,
      mode: mockAuthEnabled ? ("mock" as const) : ("cognito" as const),
    }),
    [user, loading],
  );
  useEffect(
    () =>
      configureTokenProvider(async () => {
        if (mockAuthEnabled) return "local-mock-token";
        return new Promise((resolve) => {
          const current = pool?.getCurrentUser();
          if (!current) return resolve(null);
          current.getSession(
            (error: Error | null, session: CognitoUserSession | null) =>
              resolve(
                error ? null : session?.getIdToken().getJwtToken() || null,
              ),
          );
        });
      }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="center-screen" role="status">
        Loading…
      </div>
    );
  return user ? (
    children
  ) : (
    <Navigate to="/login" state={{ from: location }} replace />
  );
}

export function LoginPage() {
  const { signIn, signUp, confirmSignUp, user, mode } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formMode, setFormMode] = useState<"login" | "signup" | "confirm">(
    "login",
  );
  const [pendingIdentifier, setPendingIdentifier] = useState("");
  if (user)
    return (
      <Navigate
        to={
          (location.state as { from?: { pathname: string } })?.from?.pathname ||
          "/library"
        }
        replace
      />
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const identifier = String(data.get("identifier") || pendingIdentifier);
      if (formMode === "confirm") {
        await confirmSignUp(identifier, String(data.get("code")));
        setFormMode("login");
      } else if (formMode === "signup") {
        const confirmationRequired = await signUp(
          identifier,
          String(data.get("password")),
        );
        if (confirmationRequired) {
          setPendingIdentifier(identifier);
          setFormMode("confirm");
        }
      } else {
        await signIn(identifier, String(data.get("password")));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <select
          aria-label={t("language")}
          value={language}
          onChange={(event) => setLanguage(event.target.value as "en" | "bo")}
        >
          <option value="en">English</option>
          <option value="bo">བོད་ཡིག</option>
        </select>
        <div className="brand-mark">ད</div>
        <p className="eyebrow">DADHEP AUDIO</p>
        <h1>{t("listenTitle")}</h1>
        <p className="muted">{t("listenBody")}</p>
        <form onSubmit={submit} className="stack">
          {formMode === "confirm" ? (
            <>
              <p>Enter the verification code sent to {pendingIdentifier}.</p>
              <label>
                {t("verificationCode")}
                <input
                  name="code"
                  inputMode="numeric"
                  required
                  autoComplete="one-time-code"
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {t("emailPhone")}
                <input
                  name="identifier"
                  type="text"
                  required
                  autoComplete="username"
                  placeholder="you@example.org or +977…"
                />
              </label>
              <label>
                {t("password")}
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete={
                    formMode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder="••••••••••"
                />
              </label>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "…"
              : formMode === "login"
                ? t("signIn")
                : formMode === "signup"
                  ? t("createAccount")
                  : t("verifyAccount")}
          </button>
        </form>
        {formMode !== "confirm" && (
          <button
            className="text-button"
            onClick={() => {
              setError("");
              setFormMode(formMode === "login" ? "signup" : "login");
            }}
          >
            {formMode === "login"
              ? t("createAccount")
              : t("signIn")}
          </button>
        )}
        {formMode === "confirm" && (
          <button className="text-button" onClick={() => setFormMode("login")}>
            {t("back")} · {t("signIn")}
          </button>
        )}
        {mode === "mock" && (
          <p className="mock-note">
            Local mock auth is on. Any email and password will work.
          </p>
        )}
      </section>
    </main>
  );
}
