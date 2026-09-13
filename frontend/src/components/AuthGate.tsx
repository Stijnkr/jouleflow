import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { t, tDynamic } from "../lib/i18n";
import { Button, TextField } from "./ui";

/** Shows the login or first-run setup screen until the user has a session. */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["auth"], queryFn: api.authStatus, retry: false });

  useEffect(() => {
    const onUnauthorized = () => queryClient.invalidateQueries({ queryKey: ["auth"] });
    window.addEventListener("jouleflow:unauthorized", onUnauthorized);
    return () => window.removeEventListener("jouleflow:unauthorized", onUnauthorized);
  }, [queryClient]);

  if (status.isPending) {
    return (
      <div className="grid min-h-full place-items-center text-muted">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  if (status.data?.authenticated) return <>{children}</>;
  return status.data?.setup_required ? <SetupScreen /> : <LoginScreen />;
}

function errorText(error: Error | null): string | null {
  if (!error) return null;
  return tDynamic(`auth.error.${error.message}`, error.message);
}

function Screen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <Zap className="size-6 text-import" strokeWidth={2.25} />
          <span className="text-xl font-semibold tracking-tight">Jouleflow</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">{description}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-import">
      <CircleAlert className="mt-0.5 size-4 shrink-0" /> {message}
    </p>
  );
}

function LoginScreen() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: () => queryClient.resetQueries(),
  });

  return (
    <Screen title={t("auth.loginTitle")} description={t("auth.loginDescription")}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <TextField
          id="login-username"
          label={t("auth.username")}
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          id="login-password"
          type="password"
          label={t("auth.password")}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorLine message={errorText(login.error)} />
        <Button type="submit" variant="primary" disabled={!username || !password || login.isPending}>
          {login.isPending && <LoaderCircle className="size-4 animate-spin" />}
          {t("auth.signIn")}
        </Button>
      </form>
    </Screen>
  );
}

function SetupScreen() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const setup = useMutation({
    mutationFn: () => api.setup(username, password, code),
    onSuccess: () => queryClient.resetQueries(),
  });
  const mismatch = repeat.length > 0 && password !== repeat;

  return (
    <Screen title={t("auth.setupTitle")} description={t("auth.setupDescription")}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) setup.mutate();
        }}
      >
        <TextField
          id="setup-code"
          label={t("auth.setupCode")}
          help={t("auth.setupCodeHelp")}
          autoComplete="off"
          autoFocus
          placeholder="XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <TextField
          id="setup-username"
          label={t("auth.username")}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          id="setup-password"
          type="password"
          label={t("auth.password")}
          help={t("auth.passwordHelp")}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          id="setup-repeat"
          type="password"
          label={t("auth.passwordRepeat")}
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <ErrorLine message={mismatch ? t("auth.mismatch") : errorText(setup.error)} />
        <Button
          type="submit"
          variant="primary"
          disabled={!code || !username || password.length < 10 || mismatch || setup.isPending}
        >
          {setup.isPending && <LoaderCircle className="size-4 animate-spin" />}
          {t("auth.createAccount")}
        </Button>
      </form>
    </Screen>
  );
}
