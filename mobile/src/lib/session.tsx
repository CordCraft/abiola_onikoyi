import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { clearPairing, loadPairing, savePairing, type Pairing } from "./storage";
import { setPairingCache } from "./api";

type Ctx = {
  ready: boolean;
  pairing: Pairing | null;
  pair: (p: Pairing) => Promise<void>;
  unpair: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  useEffect(() => {
    loadPairing()
      .then((p) => {
        setPairingCache(p);
        setPairing(p);
      })
      .finally(() => setReady(true));
  }, []);

  const pair = useCallback(async (p: Pairing) => {
    await savePairing(p);
    setPairingCache(p);
    setPairing(p);
  }, []);

  const unpair = useCallback(async () => {
    await clearPairing();
    setPairingCache(null);
    setPairing(null);
  }, []);

  return <SessionContext.Provider value={{ ready, pairing, pair, unpair }}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
