'use client';

import {
  Activity,
  CheckCircle2,
  Coins,
  Loader2,
  LogOut,
  PiggyBank,
  Receipt,
  Sprout,
  Store,
  TrendingUp,
  Trophy,
  Users,
  Vote,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const IDR_PER_USDC = 16_300;
const fmtIdr = (usdc: number | string) => {
  const n = typeof usdc === 'number' ? usdc : Number.parseFloat(usdc);
  return `Rp ${Math.round(n * IDR_PER_USDC).toLocaleString('id-ID')}`;
};

type Stats = {
  vaultId: string;
  vaultName: string;
  vaultAddress: string;
  vaultContractId: string;
  apyPercent: string;
  principalUsdc: string;
  accruedYieldUsdc: string;
  poolTotalUsdc: string;
  totalRoundUps: number;
  contributorCount: number;
  merchantCount: number;
  shopperCount: number;
  proposalCount: number;
  grantsDisbursed: number;
  grantedUsdc: string;
};

type ContributorView = {
  id: string;
  name: string;
  role: string;
  cause: string;
  totalContributedUsdc: string;
  roundUpCount: number;
};

type ProposalView = {
  id: string;
  title: string;
  organization: string;
  description: string;
  requestedUsdc: string;
  voteWeightUsdc: string;
  status: string;
  disburseTxHash: string;
  voteCount: number;
};

type RoundUpView = {
  id: string;
  contributorId: string;
  purchaseUsdc: string;
  contributionUsdc: string;
  muxedAddress: string;
  createdAt: string;
};

const POOL_GOAL_USDC = 200;

export function RecehClient(props: {
  empty?: boolean;
  stats: Stats | null;
  contributors: ContributorView[];
  proposals: ProposalView[];
  recentRoundUps: RoundUpView[];
  idrRate: string;
}) {
  const [stats, setStats] = useState(props.stats);
  const [proposals, setProposals] = useState(props.proposals);
  const [roundUps, setRoundUps] = useState(props.recentRoundUps);
  const [contributors] = useState(props.contributors);

  const [purchase, setPurchase] = useState('4.30');
  const [activeContributor, setActiveContributor] = useState(
    props.contributors.find((c) => c.role === 'shopper')?.id ?? props.contributors[0]?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [enablingTrust, setEnablingTrust] = useState(false);
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [registeredContributorId, setRegisteredContributorId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.ok && j?.data?.connected && j.data.publicKey) {
          setWalletKey(j.data.publicKey);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureContributorForWallet(publicKey: string): Promise<string | null> {
    const shortAddr = `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
    const existing = contributors.find((c) => c.id === registeredContributorId);
    if (existing) return existing.id;
    try {
      const lookup = await fetch(`/api/contributors/by-pubkey/${encodeURIComponent(publicKey)}`).catch(
        () => null,
      );
      if (lookup?.ok) {
        const j = await lookup.json();
        if (j?.ok && j?.data?.id) {
          setRegisteredContributorId(j.data.id);
          return j.data.id;
        }
      }
      const res = await fetch('/api/contributors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: shortAddr,
          role: 'shopper',
          stellarAddress: publicKey,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error?.message ?? 'Could not register contributor');
        return null;
      }
      setRegisteredContributorId(json.data.id);
      return json.data.id;
    } catch {
      return null;
    }
  }

  async function connectWallet() {
    setConnecting(true);
    try {
      const freighterApi: { requestAccess?: () => Promise<{ address?: string }> } =
        (await import('@stellar/freighter-api').catch(() => ({}))) as never;
      const requestAccess = freighterApi.requestAccess;
      if (!requestAccess) {
        toast.error('Freighter wallet not detected. Install it to continue.');
        return;
      }
      const access = await requestAccess();
      const publicKey = access?.address;
      if (!publicKey) {
        toast.error('Freighter returned no public key.');
        return;
      }
      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey }),
      });
      const challengeJson = await challengeRes.json();
      if (!challengeJson.ok) {
        toast.error(challengeJson.error?.message ?? 'Could not request challenge');
        return;
      }
      const signModule: { signMessage?: (m: string, opts?: { address?: string }) => Promise<{ signedMessage?: string }> } =
        (await import('@stellar/freighter-api').catch(() => ({}))) as never;
      const signed = await signModule.signMessage?.(challengeJson.data.nonce, {
        address: publicKey,
      });
      if (!signed?.signedMessage) {
        toast.error('Freighter did not return a signature.');
        return;
      }
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey,
          nonce: challengeJson.data.nonce,
          signedNonce: signed.signedMessage,
        }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyJson.ok) {
        toast.error(verifyJson.error?.message ?? 'Session could not be verified.');
        return;
      }
      setWalletKey(publicKey);
      const cid = await ensureContributorForWallet(publicKey);
      if (cid) {
        setActiveContributor(cid);
        toast.success(`Connected — registered as contributor ${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`);
      } else {
        toast.success(`Connected wallet ${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Wallet connect failed');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWallet() {
    try {
      await fetch('/api/auth/me', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    setWalletKey(null);
    setRegisteredContributorId(null);
    toast.message('Wallet disconnected');
  }

  const refresh = async () => {
    try {
      const [vRes, pRes, rRes] = await Promise.all([
        fetch('/api/vault'),
        fetch(`/api/proposals${stats ? `?vaultId=${stats.vaultId}` : ''}`),
        fetch('/api/roundups'),
      ]);
      const vJson = await vRes.json();
      if (vJson.ok) setStats(vJson.data);
      const pJson = await pRes.json();
      if (pJson.ok) {
        setProposals((prev) =>
          (pJson.data as ProposalView[]).map((p) => ({
            ...p,
            voteCount: prev.find((x) => x.id === p.id)?.voteCount ?? 0,
          })),
        );
      }
      const rJson = await rRes.json();
      if (rJson.ok) setRoundUps(rJson.data as RoundUpView[]);
    } catch {
      /* ignore */
    }
  };

  const contribution = useMemo(() => {
    const amt = Number.parseFloat(purchase);
    if (!Number.isFinite(amt) || amt < 0) return 0;
    const delta = Math.ceil(amt) - amt;
    return Math.round(delta * 100) / 100;
  }, [purchase]);

  async function handleRoundUp() {
    if (!activeContributor) {
      toast.error('Pick a contributor first');
      return;
    }
    if (contribution <= 0) {
      toast.error('Enter a purchase with spare change (not a whole number)');
      return;
    }
    const txHash = window.prompt(
      `Send ${contribution.toFixed(2)} USDC to the vault M-address in your Freighter wallet, then paste the 64-char Horizon txHash here:`,
      '',
    );
    if (!txHash) {
      toast.error('A real Horizon txHash is required to record the round-up.');
      return;
    }
    if (!/^[a-f0-9]{64}$/i.test(txHash)) {
      toast.error('txHash must be 64 hex characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/roundups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contributorId: activeContributor,
          purchaseUsdc: purchase,
          txHash,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? 'Round-up failed');
      toast.success(
        json.data.contractAttempt?.invoked
          ? `Routed ${fmtIdr(json.data.contribution)} into the vault — contract.record_roundup XDR ready for Freighter.`
          : `Routed ${fmtIdr(json.data.contribution)} into the vault (on-chain record_roundup pending).`,
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Round-up failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableUsdc() {
    if (!walletKey) {
      toast.error('Connect your Freighter wallet first');
      return;
    }
    setEnablingTrust(true);
    try {
      const buildRes = await fetch('/api/trustline/usdc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: walletKey }),
      });
      const buildJson = await buildRes.json();
      if (!buildJson.ok) throw new Error(buildJson.error?.message ?? 'Trustline build failed');
      const signModule: { signTransaction?: (
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string },
      ) => Promise<{ signedTxXdr?: string }> } =
        (await import('@stellar/freighter-api').catch(() => ({}))) as never;
      const signed = await signModule.signTransaction?.(buildJson.data.xdr, {
        networkPassphrase: buildJson.data.networkPassphrase,
        address: walletKey,
      });
      if (!signed?.signedTxXdr) {
        toast.error('Freighter did not return a signed transaction.');
        return;
      }
      toast.success('USDC trustline signed — submit it from Freighter to activate USDC.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Trustline failed');
    } finally {
      setEnablingTrust(false);
    }
  }

  async function handleVote(proposalId: string) {
    if (!activeContributor) {
      toast.error('Pick a contributor first');
      return;
    }
    try {
      const res = await fetch(`/api/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contributorId: activeContributor }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? 'Vote failed');
      toast.success('Vote cast — weighted by your contributions');
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposalId
            ? {
                ...p,
                voteCount: p.voteCount + 1,
                voteWeightUsdc: json.data.tally.totalWeightUsdc,
              }
            : p,
        ),
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Vote failed');
    }
  }

  async function handleCloseWindow() {
    setClosing(true);
    try {
      const res = await fetch('/api/vote-window/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stats ? { vaultId: stats.vaultId } : {}),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? 'Could not close window');
      if (json.data.winnerId) {
        toast.success('Voting closed — grant disbursed from the vault on-chain');
      } else {
        toast.message('No open proposals to close');
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not close window');
    } finally {
      setClosing(false);
    }
  }

  // Live thermometer + yield ticker
  const poolTotal = stats ? Number.parseFloat(stats.poolTotalUsdc) : 0;
  const yieldUsdc = stats ? Number.parseFloat(stats.accruedYieldUsdc) : 0;
  const fillPct = Math.min(100, Math.round((poolTotal / POOL_GOAL_USDC) * 100));

  const [tickYield, setTickYield] = useState(yieldUsdc);
  useEffect(() => {
    setTickYield(yieldUsdc);
  }, [yieldUsdc]);
  useEffect(() => {
    if (!stats || props.empty) return;
    const apy = Number.parseFloat(stats.apyPercent) / 100;
    const perSec = (poolTotal * apy) / (365 * 24 * 60 * 60);
    const t = setInterval(() => setTickYield((y) => y + perSec * 2), 2000);
    return () => clearInterval(t);
  }, [stats, poolTotal, props.empty]);

  const disbursedProposal = proposals.find((p) => p.status === 'disbursed');

  if (props.empty || !stats) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar
          walletKey={walletKey}
          onConnect={connectWallet}
          onDisconnect={disconnectWallet}
          connecting={connecting}
        />
        <main className="flex-1 flex items-center justify-center px-6">
          <div
            data-testid="empty-state"
            className="text-center max-w-md py-24 flex flex-col items-center"
          >
            <div className="bg-emerald-50 p-5 rounded-2xl mb-6">
              <Sprout className="w-12 h-12 text-emerald-600" aria-hidden="true" />
            </div>
            <h2 className="text-3xl mb-3 text-slate-900">No spare change pooled yet</h2>
            <p className="text-slate-600 leading-relaxed">
              Once a merchant embeds the Receh widget and shoppers round up their first USDC
              purchases, the community vault starts to grow here — and the impact thermometer begins
              to climb.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar
        walletKey={walletKey}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
        connecting={connecting}
      />

      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-500 text-white">
        <div className="absolute inset-0 opacity-15" aria-hidden="true">
          <div className="absolute -top-10 left-10 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-teal-200 blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-16 md:py-20 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-flex items-center gap-2 bg-white/15 px-3 py-1.5 rounded-full text-sm font-medium text-emerald-50 mb-6">
              <Coins className="w-4 h-4" aria-hidden="true" /> Track B — Savings &amp; DeFi
            </span>
            <h1 className="text-4xl md:text-6xl leading-[1.05] mb-5">
              Spare change that
              <br />
              <span className="italic text-emerald-100">grows communities.</span>
            </h1>
            <p className="text-lg text-emerald-50 max-w-xl mb-8 leading-relaxed">
              Receh rounds up every USDC purchase and routes the spare change through SEP-7 into a
              shared DeFindex yield vault. The pool earns variable Blend-market yield, then
              merchants and shoppers vote each month on which local projects get grants.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#widget"
                data-testid="cta-roundup"
                className="inline-flex items-center justify-center gap-2 bg-white text-emerald-700 font-semibold px-7 h-12 rounded-xl text-base hover:bg-emerald-50 transition-colors shadow-lg"
              >
                <Receipt className="w-5 h-5" aria-hidden="true" /> Try the round-up widget
              </a>
              <a
                href="#vote"
                data-testid="cta-vote"
                className="inline-flex items-center justify-center gap-2 border-2 border-white text-white font-semibold px-7 h-12 rounded-xl text-base hover:bg-white/10 transition-colors"
              >
                <Vote className="w-5 h-5" aria-hidden="true" /> See community vote
              </a>
            </div>
          </div>

          
          <div className="bg-white/10 backdrop-blur rounded-3xl p-7 border border-white/20">
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-emerald-50">Community vault</span>
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-100">
                <TrendingUp className="w-4 h-4" aria-hidden="true" /> {stats.apyPercent}% APY
              </span>
            </div>
            <div
              data-testid="pool-total"
              className="text-5xl font-bold tracking-tight mb-1 tabular-nums"
            >
              {Number.parseFloat(stats.poolTotalUsdc).toFixed(2)} USDC
            </div>
            <div className="text-emerald-100 mb-5">{fmtIdr(stats.poolTotalUsdc)} pooled</div>

            
            <div className="relative h-5 rounded-full bg-emerald-900/40 overflow-hidden mb-2">
              <div
                data-testid="thermometer-fill"
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-lime-300 to-emerald-200 transition-all duration-700"
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-emerald-100 mb-5">
              <span>{fillPct}% to next grant round</span>
              <span>Goal {POOL_GOAL_USDC} USDC</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-white/10 rounded-xl py-3">
                <div className="text-xs text-emerald-100 mb-1">Yield accrued</div>
                <div data-testid="yield-ticker" className="text-lg font-semibold tabular-nums">
                  +{tickYield.toFixed(4)}
                </div>
              </div>
              <div className="bg-white/10 rounded-xl py-3">
                <div className="text-xs text-emerald-100 mb-1">Round-ups</div>
                <div data-testid="roundup-count" className="text-lg font-semibold tabular-nums">
                  {stats.totalRoundUps}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      
      <section className="bg-emerald-900 text-white py-5">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <Stat
            label="Principal pooled"
            value={`${Number.parseFloat(stats.principalUsdc).toFixed(2)} USDC`}
          />
          <Stat label="Contributors" value={`${stats.contributorCount}`} />
          <Stat label="Grant proposals" value={`${stats.proposalCount}`} />
          <Stat label="Grants disbursed" value={`${stats.grantedUsdc} USDC`} />
        </div>
      </section>

      <main className="flex-1 max-w-6xl mx-auto px-6 py-12 w-full grid lg:grid-cols-3 gap-8">
        
        <div className="lg:col-span-2 space-y-8">
          
          <div id="widget" className="bg-card rounded-3xl border border-emerald-100 p-7 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              <h2 className="text-2xl text-slate-900">Embeddable checkout widget</h2>
            </div>
            <p className="text-slate-600 mb-6">
              A shopper pays for a purchase; Receh rounds it up to the next whole USDC and routes
              the spare change into the shared vault via a SEP-7 payment.
            </p>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label
                  htmlFor="contributor"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Shopper wallet
                </label>
                <div
                  data-testid="select-contributor"
                  className="w-full h-12 rounded-xl border border-slate-300 px-3 text-base text-slate-800 bg-slate-50 flex items-center font-mono"
                >
                  {walletKey
                    ? `${walletKey.slice(0, 4)}…${walletKey.slice(-4)}`
                    : 'Connect Freighter to attribute your round-ups'}
                </div>
                {contributors.length > 0 && (
                  <select
                    aria-label="Other contributors"
                    value={activeContributor}
                    onChange={(e) => setActiveContributor(e.target.value)}
                    className="mt-2 w-full h-10 rounded-lg border border-slate-200 px-2 text-sm text-slate-700 bg-white"
                  >
                    {contributors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.role})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label
                  htmlFor="purchase"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Purchase amount (USDC)
                </label>
                <input
                  id="purchase"
                  data-testid="input-purchase"
                  inputMode="decimal"
                  value={purchase}
                  onChange={(e) => setPurchase(e.target.value)}
                  className="w-full h-12 rounded-xl border border-slate-300 px-3 text-base text-slate-800 bg-white tabular-nums"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between bg-emerald-50 rounded-2xl px-5 py-4">
              <div>
                <div className="text-sm text-slate-600">Spare change to vault</div>
                <div
                  data-testid="contribution-preview"
                  className="text-2xl font-bold text-emerald-700 tabular-nums"
                >
                  {contribution.toFixed(2)} USDC
                </div>
                <div className="text-sm text-slate-500">{fmtIdr(contribution)}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  data-testid="roundup-btn"
                  onClick={handleRoundUp}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold px-6 h-12 rounded-xl text-base hover:bg-emerald-700 transition-colors disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Coins className="w-5 h-5" aria-hidden="true" />
                  )}
                  Round up &amp; route
                </button>
                <button
                  type="button"
                  data-testid="enable-usdc-btn"
                  onClick={handleEnableUsdc}
                  disabled={!walletKey || enablingTrust}
                  className="inline-flex items-center justify-center gap-2 border border-emerald-600 text-emerald-700 font-semibold px-4 h-9 rounded-lg text-sm hover:bg-emerald-100 transition-colors disabled:opacity-60"
                >
                  {enablingTrust ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Wallet className="w-4 h-4" aria-hidden="true" />
                  )}
                  Enable USDC trustline
                </button>
              </div>
            </div>
          </div>

          
          <div className="bg-card rounded-3xl border border-emerald-100 p-7 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              <h2 className="text-2xl text-slate-900">Live round-up feed</h2>
            </div>
            <ul data-testid="live-feed" className="space-y-2">
              {roundUps.length === 0 && (
                <li className="text-slate-500 text-sm">No round-ups yet.</li>
              )}
              {roundUps.map((r) => {
                const c = contributors.find((x) => x.id === r.contributorId);
                return (
                  <li
                    key={r.id}
                    data-testid="feed-item"
                    className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Coins className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                      <span className="text-slate-700 truncate">
                        {c?.name ?? 'Shopper'} rounded up a{' '}
                        {Number.parseFloat(r.purchaseUsdc).toFixed(2)} USDC purchase
                      </span>
                    </div>
                    <span className="font-semibold text-emerald-700 tabular-nums shrink-0">
                      +{Number.parseFloat(r.contributionUsdc).toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          
          <div id="vote" className="bg-card rounded-3xl border border-emerald-100 p-7 shadow-sm">
            <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Vote className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                <h2 className="text-2xl text-slate-900">Monthly community grant vote</h2>
              </div>
              <button
                type="button"
                data-testid="close-window-btn"
                onClick={handleCloseWindow}
                disabled={closing}
                className="inline-flex items-center justify-center gap-2 bg-amber-500 text-white font-semibold px-5 h-11 rounded-xl text-sm hover:bg-amber-600 transition-colors disabled:opacity-60"
              >
                {closing ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trophy className="w-4 h-4" aria-hidden="true" />
                )}
                Close window &amp; disburse
              </button>
            </div>

            <div data-testid="proposal-list" className="space-y-4">
              {proposals.map((p) => (
                <ProposalCard key={p.id} p={p} onVote={() => handleVote(p.id)} />
              ))}
            </div>
          </div>
        </div>

        
        <aside className="space-y-8">
          {disbursedProposal && (
            <div
              data-testid="disburse-banner"
              className="bg-emerald-600 text-white rounded-3xl p-6 shadow-md"
            >
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                <span className="font-semibold">Grant disbursed</span>
              </div>
              <p className="text-emerald-50 text-sm mb-3">
                {disbursedProposal.requestedUsdc} USDC sent from the vault to{' '}
                {disbursedProposal.organization}.
              </p>
              <div className="bg-emerald-700/60 rounded-xl px-3 py-2 text-xs font-mono break-all">
                tx: {disbursedProposal.disburseTxHash}
              </div>
            </div>
          )}

          <div className="bg-card rounded-3xl border border-emerald-100 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <PiggyBank className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              <h3 className="text-xl text-slate-900">DeFindex vault</h3>
            </div>
            <dl className="space-y-2 text-sm">
              <Row k="Principal" v={`${Number.parseFloat(stats.principalUsdc).toFixed(2)} USDC`} />
              <Row
                k="Yield accrued"
                v={`${Number.parseFloat(stats.accruedYieldUsdc).toFixed(4)} USDC`}
              />
              <Row k="Pool total" v={`${Number.parseFloat(stats.poolTotalUsdc).toFixed(2)} USDC`} />
              <Row k="Variable APY" v={`${stats.apyPercent}%`} />
            </dl>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="text-xs text-slate-500 mb-1">Vault contract (Soroban)</div>
              <div className="text-xs font-mono text-slate-600 break-all">
                {stats.vaultContractId || stats.vaultAddress}
              </div>
            </div>
          </div>

          <div className="bg-card rounded-3xl border border-emerald-100 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              <h3 className="text-xl text-slate-900">Top contributors</h3>
            </div>
            {contributors.length === 0 ? (
              <p className="text-slate-500 text-sm leading-relaxed">
                No contributors yet. Connect your Freighter wallet above and try the round-up widget to
                become the first contributor on the leaderboard.
              </p>
            ) : (
              <ul className="space-y-3">
                {contributors.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.role === 'merchant' ? (
                        <Store className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <Coins className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                      )}
                      <span className="text-slate-700 truncate font-mono text-sm">{c.name}</span>
                    </div>
                    <span className="font-semibold text-slate-800 tabular-nums shrink-0">
                      {Number.parseFloat(c.totalContributedUsdc).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-emerald-50 rounded-3xl border border-emerald-100 p-6">
            <p className="text-slate-700 leading-relaxed mb-3 text-sm">
              &ldquo;Spare change is too small to matter alone. Pooled across a whole neighbourhood,
              it pays for something real — and every contributor can see exactly where it went.&rdquo;
            </p>
            <div className="font-semibold text-emerald-700">Why round-ups work</div>
            <div className="text-slate-500 text-sm">
              Micro-contributions, transparent on-chain attribution
            </div>
          </div>
        </aside>
      </main>

      <Footer />
    </div>
  );
}

function ProposalCard({ p, onVote }: { p: ProposalView; onVote: () => void }) {
  const statusStyle: Record<string, string> = {
    voting: 'bg-sky-100 text-sky-800',
    approved: 'bg-amber-100 text-amber-800',
    rejected: 'bg-slate-200 text-slate-700',
    disbursed: 'bg-emerald-100 text-emerald-800',
  };
  return (
    <div data-testid="proposal-card" className="border border-slate-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h4 className="text-lg font-semibold text-slate-900">{p.title}</h4>
          <div className="text-sm text-slate-500">{p.organization}</div>
        </div>
        <span
          data-testid="proposal-status"
          className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${statusStyle[p.status] ?? ''}`}
        >
          {p.status}
        </span>
      </div>
      <p className="text-slate-600 text-sm mb-4 leading-relaxed">{p.description}</p>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{p.requestedUsdc} USDC</span> requested ·{' '}
          <span data-testid="vote-weight">{Number.parseFloat(p.voteWeightUsdc).toFixed(2)}</span>{' '}
          weight · {p.voteCount} votes
        </div>
        {p.status === 'voting' ? (
          <button
            type="button"
            data-testid="vote-btn"
            onClick={onVote}
            className="inline-flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold px-5 h-11 rounded-xl text-sm hover:bg-emerald-700 transition-colors"
          >
            <Vote className="w-4 h-4" aria-hidden="true" /> Vote
          </button>
        ) : p.status === 'disbursed' ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold text-sm">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Funded
          </span>
        ) : null}
      </div>
      {p.status === 'disbursed' && p.disburseTxHash && (
        <div
          data-testid="proposal-tx"
          className="mt-3 bg-emerald-50 rounded-lg px-3 py-2 text-xs font-mono text-emerald-700 break-all"
        >
          disburse tx: {p.disburseTxHash}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-emerald-100 tabular-nums">{value}</div>
      <div className="text-emerald-300 text-sm mt-1">{label}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-semibold text-slate-800 tabular-nums">{v}</dd>
    </div>
  );
}

function Navbar({
  walletKey,
  onConnect,
  onDisconnect,
  connecting,
}: {
  walletKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
}) {
  return (
    <header className="border-b border-emerald-100 bg-white/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1.5 rounded-lg">
            <Sprout className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <span className="font-bold text-lg text-slate-900">Receh</span>
          <span className="text-xs text-slate-400 ml-2 hidden md:inline">
            Round-up yield pool · Stellar Testnet
          </span>
        </div>
        <div className="flex items-center gap-3">
          {walletKey ? (
            <>
              <span
                data-testid="account-chip"
                className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded-full text-sm font-mono"
              >
                <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                {walletKey.slice(0, 4)}…{walletKey.slice(-4)}
              </span>
              <button
                type="button"
                onClick={onDisconnect}
                className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" /> Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="connect-btn"
              onClick={onConnect}
              disabled={connecting}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white font-semibold px-4 h-10 rounded-xl text-sm hover:bg-emerald-700 transition-colors disabled:opacity-60"
            >
              {connecting ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Wallet className="w-4 h-4" aria-hidden="true" />
              )}
              Connect Freighter
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400 py-8 mt-auto">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sprout className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          <span className="font-semibold text-white">Receh</span>
        </div>
        <p className="text-sm text-center">
          Built on Stellar Testnet · Track B — Savings &amp; DeFi · APAC Hackathon 2026
        </p>
      </div>
    </footer>
  );
}
