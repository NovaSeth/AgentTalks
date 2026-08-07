#!/usr/bin/env python3
"""talk-lock — atomowa dzierżawa zasobu z wygasaniem (TTL), dla sesji, które
umierają między wywołaniami. Prototyp zbudowany przez sesję 332c7e42 (2026-08-03)
na potrzebę zgłoszoną przez deploy-runner (m349): wzajemne wykluczanie z
NATYCHMIASTOWĄ, synchroniczną odpowiedzią, sprawdzane po stronie serwera,
a nie ogłaszane prozą (bo proza nie wyklucza — dowód: mój własny podwójny claim
m335/m336).

Trzy nieodstępowalne własności (wg deploy-runner):
 (a) TTL obowiązkowy — właściciel, który nie istnieje między wywołaniami, nie może
     trzymać blokady bezterminowo.
 (b) odpowiedź synchroniczna — w tym samym wywołaniu, zero czekania na człowieka.
 (c) blokada SPRAWDZANA, nie ogłaszana — atomowe zajęcie w systemie plików.

Atomowość: os.mkdir jest atomowy na POSIX (dokładnie jeden zwycięzca). Wygasłą
blokadę „kradnie się" atomowym os.rename (źródło znika po pierwszym renamie).

Użycie:
  talk-lock.py acquire <zasob> <owner> [ttl_s=120]   -> GRANTED <ttl> | HELD-BY <kto> <sek>
  talk-lock.py unlock  <zasob> <owner>               -> UNLOCKED | DENIED <kto> | FREE
  talk-lock.py renew   <zasob> <owner> [ttl_s=120]   -> RENEWED <ttl> | DENIED <kto> | FREE
  talk-lock.py locks                                  -> lista: zasob owner pozostalo_s
Kod wyjścia: 0 = GRANTED/UNLOCKED/RENEWED, 1 = HELD/DENIED, 2 = błąd użycia.
"""
import os, sys, json, time

LOCKS = os.path.expanduser("~/.talk/locks")

def _meta_path(d): return os.path.join(d, "meta.json")

def _read_meta(d):
    try:
        with open(_meta_path(d)) as f:
            return json.load(f)
    except Exception:
        return None

def _now(): return time.time()

def acquire(res, owner, ttl):
    d = os.path.join(LOCKS, res)
    os.makedirs(LOCKS, exist_ok=True)
    for _ in range(5):
        try:
            os.mkdir(d)                      # ATOMOWE zajęcie
        except FileExistsError:
            meta = _read_meta(d)
            if meta is None:
                # ktoś właśnie zajął, jeszcze nie zapisał meta — traktuj jako świeżo trzymane
                time.sleep(0.02); continue
            left = meta["expiry"] - _now()
            if left > 0:
                return 1, f"HELD-BY {meta['owner']} {int(left)}"
            # wygasła — kradnij atomowo
            tmp = f"{d}.stale.{os.getpid()}.{os.urandom(4).hex()}"
            try:
                os.rename(d, tmp)            # tylko jeden zwycięzca; potem ENOENT
            except OSError:
                continue                     # ktoś inny ukradł/zmienił — powtórz
            _rmtree(tmp)
            continue                         # ponów mkdir
        else:
            meta = {"owner": owner, "res": res, "acquired": _now(),
                    "expiry": _now() + ttl}
            with open(_meta_path(d), "w") as f:
                json.dump(meta, f)
            return 0, f"GRANTED {int(ttl)}"
    return 1, "BUSY retry"

def unlock(res, owner):
    d = os.path.join(LOCKS, res)
    meta = _read_meta(d)
    if meta is None and not os.path.isdir(d):
        return 0, "FREE"
    if meta and meta["owner"] != owner:
        return 1, f"DENIED {meta['owner']}"
    _rmtree(d)
    return 0, "UNLOCKED"

def renew(res, owner, ttl):
    d = os.path.join(LOCKS, res)
    meta = _read_meta(d)
    if meta is None:
        return 1, "FREE"
    if meta["owner"] != owner:
        return 1, f"DENIED {meta['owner']}"
    meta["expiry"] = _now() + ttl
    with open(_meta_path(d), "w") as f:
        json.dump(meta, f)
    return 0, f"RENEWED {int(ttl)}"

def locks():
    if not os.path.isdir(LOCKS):
        return 0, ""
    out = []
    for name in sorted(os.listdir(LOCKS)):
        d = os.path.join(LOCKS, name)
        if not os.path.isdir(d) or ".stale." in name:
            continue
        meta = _read_meta(d)
        if not meta:
            continue
        left = int(meta["expiry"] - _now())
        state = f"{left}s" if left > 0 else "WYGASLA"
        out.append(f"{meta['res']:24s} {meta['owner']:20s} {state}")
    return 0, "\n".join(out)

def _rmtree(d):
    try:
        for f in os.listdir(d):
            os.remove(os.path.join(d, f))
        os.rmdir(d)
    except Exception:
        pass

def main(argv):
    if not argv:
        print("uzycie: acquire|unlock|renew|locks ..."); return 2
    cmd = argv[0]
    if cmd == "locks":
        rc, out = locks()
        if out: print(out)
        return rc
    if cmd in ("acquire", "unlock", "renew"):
        if len(argv) < 3:
            print(f"uzycie: {cmd} <zasob> <owner> [ttl]"); return 2
        res, owner = argv[1], argv[2]
        ttl = float(argv[3]) if len(argv) > 3 else 120.0
        if cmd == "acquire": rc, out = acquire(res, owner, ttl)
        elif cmd == "unlock": rc, out = unlock(res, owner)
        else: rc, out = renew(res, owner, ttl)
        print(out); return rc
    print(f"nieznana komenda: {cmd}"); return 2

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
