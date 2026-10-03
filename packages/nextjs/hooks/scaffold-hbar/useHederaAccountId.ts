import { useEffect, useState } from "react";
import { chainIdToHederaNetwork, getHederaAccountId } from "~~/utils/scaffold-hbar";

export function useHederaAccountId(evmAddress: string | undefined, chainId?: number) {
  const [accountId, setAccountId] = useState<string | null>(null);
  // True when the lookup itself failed, so a null accountId can't be told apart from "no account".
  const [lookupFailed, setLookupFailed] = useState(false);
  // Start as loading when there is an address, so callers never see a "not found" before the lookup runs.
  const [isLoading, setIsLoading] = useState(!!evmAddress);

  useEffect(() => {
    if (!evmAddress) {
      setAccountId(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const network = chainIdToHederaNetwork(chainId ?? 296);

    setIsLoading(true);
    setLookupFailed(false);

    getHederaAccountId(evmAddress, network)
      .then(id => {
        if (!cancelled) setAccountId(id);
      })
      .catch(() => {
        if (!cancelled) {
          setAccountId(null);
          setLookupFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [evmAddress, chainId]);

  return { accountId, isLoading, lookupFailed };
}
