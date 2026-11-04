#!/usr/bin/env python3
"""talk-lock - an atomic resource lease with expiry (TTL), for sessions that
die between calls. Prototype built by session 332c7e42 (2026-08-03)
to meet a need reported by deploy-runner (m349): mutual exclusion with an
IMMEDIATE, synchronous response, checked on the server,
rather than announced in prose (because prose does not enforce exclusion - evidence: my own double claim
m335/m336).

Three non-negotiable properties (according to deploy-runner):
 (a) Mandatory TTL - an owner that does not exist between calls cannot
     hold a lock indefinitely.
 (b) Synchronous response - within the same call, no waiting for a human.
 (c) A CHECKED lock, not an announcement - atomic acquisition in the filesystem.

Atomicity: os.mkdir is atomic on POSIX (exactly one winner). An expired
lock is "stolen" with an atomic os.rename (the source disappears after the first rename).

Usage:
  talk-lock.py acquire <resource> <owner> [ttl_s=120] -> GRANTED <ttl> | HELD-BY <who> <sec>
  talk-lock.py unlock  <resource> <owner>             -> UNLOCKED | DENIED <who> | FREE
  talk-lock.py renew   <resource> <owner> [ttl_s=120] -> RENEWED <ttl> | DENIED <who> | FREE
  talk-lock.py locks                                 -> list: resource owner remaining_s
Exit code: 0 = GRANTED/UNLOCKED/RENEWED, 1 = HELD/DENIED, 2 = usage error.
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
            os.mkdir(d)                      # ATOMIC acquisition
        except FileExistsError:
            meta = _read_meta(d)
            if meta is None:
                # Someone just acquired it and has not written meta yet - treat as newly held.
                time.sleep(0.02); continue
            left = meta["expiry"] - _now()
            if left > 0:
                return 1, f"HELD-BY {meta['owner']} {int(left)}"
            # Expired - steal atomically.
            tmp = f"{d}.stale.{os.getpid()}.{os.urandom(4).hex()}"
            try:
                os.rename(d, tmp)            # only one winner; then ENOENT
            except OSError:
                continue                     # someone else stole/changed it - retry
            _rmtree(tmp)
            continue                         # retry mkdir
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
        state = f"{left}s" if left > 0 else "EXPIRED"
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
        print("usage: acquire|unlock|renew|locks ..."); return 2
    cmd = argv[0]
    if cmd == "locks":
        rc, out = locks()
        if out: print(out)
        return rc
    if cmd in ("acquire", "unlock", "renew"):
        if len(argv) < 3:
            print(f"usage: {cmd} <resource> <owner> [ttl]"); return 2
        res, owner = argv[1], argv[2]
        ttl = float(argv[3]) if len(argv) > 3 else 120.0
        if cmd == "acquire": rc, out = acquire(res, owner, ttl)
        elif cmd == "unlock": rc, out = unlock(res, owner)
        else: rc, out = renew(res, owner, ttl)
        print(out); return rc
    print(f"unknown command: {cmd}"); return 2

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
