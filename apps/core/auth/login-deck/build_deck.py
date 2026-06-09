#!/usr/bin/env python3
"""Render the LOGIN spec as a JPEG slide deck (1920x1080, 16:9).

Pure Pillow — no external services. Re-run to regenerate:
    python3 build_deck.py
Outputs slide-01.jpg ... slide-NN.jpg beside this script.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1920, 1080

# palette
WHITE  = (255, 255, 255)
INK    = (23, 31, 50)       # near-black navy, body + titles
ACCENT = (79, 70, 229)      # indigo
ACCENT2= (217, 70, 239)     # magenta tint for the title block
MUTED  = (110, 120, 140)    # captions / footer
PANEL  = (244, 246, 251)    # light panels
RULE   = (224, 228, 238)
BULLET = (79, 70, 229)

F_ARIAL_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
F_ARIAL   = "/System/Library/Fonts/Supplemental/Arial.ttf"
F_MONO    = "/System/Library/Fonts/SFNSMono.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

# cache a few sizes
TITLE   = font(F_ARIAL_B, 64)
H1      = font(F_ARIAL_B, 52)
LEAD    = font(F_ARIAL_B, 30)
BODY    = font(F_ARIAL, 34)
BODYB   = font(F_ARIAL_B, 34)
SUB     = font(F_ARIAL, 29)
SMALL   = font(F_ARIAL, 24)
MONO    = font(F_MONO, 26)
BIG     = font(F_ARIAL_B, 92)

MARGIN_X = 130

def wrap(draw, text, fnt, max_w):
    words = text.split()
    lines, cur = [], ""
    for word in words:
        trial = (cur + " " + word).strip()
        if draw.getlength(trial) if hasattr(draw, "getlength") else fnt.getlength(trial) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines

def text_w(fnt, s):
    return fnt.getlength(s)

def new_canvas():
    img = Image.new("RGB", (W, H), WHITE)
    return img, ImageDraw.Draw(img)

def chrome(draw, idx, total, kicker):
    """header accent + footer, shared by content slides."""
    # top accent bar
    draw.rectangle([0, 0, W, 14], fill=ACCENT)
    # kicker (eyebrow)
    draw.text((MARGIN_X, 70), kicker.upper(), font=SMALL, fill=ACCENT)
    # footer rule
    draw.line([(MARGIN_X, H - 78), (W - MARGIN_X, H - 78)], fill=RULE, width=2)
    draw.text((MARGIN_X, H - 60), "rupng  ·  auth  ·  LOGIN", font=SMALL, fill=MUTED)
    num = f"{idx:02d} / {total:02d}"
    draw.text((W - MARGIN_X - text_w(SMALL, num), H - 60), num, font=SMALL, fill=MUTED)

def title_block(draw, title):
    draw.text((MARGIN_X, 108), title, font=H1, fill=INK)
    # accent underline
    tw = text_w(H1, title)
    draw.rectangle([MARGIN_X, 184, MARGIN_X + min(tw, 520), 192], fill=ACCENT)

def render_bullets(draw, items, top=240):
    """items: list of (level, text, kind) kind in {'', 'lead', 'note'}"""
    y = top
    max_w = W - MARGIN_X * 2 - 60
    for level, txt, kind in items:
        indent = MARGIN_X + 18 + level * 56
        fnt = BODYB if kind == "lead" else (SUB if level > 0 else BODY)
        color = INK if kind != "note" else MUTED
        bw = max_w - level * 56
        lines = wrap(draw, txt, fnt, bw)
        # bullet marker
        if kind == "note":
            draw.text((indent, y + 6), "—", font=fnt, fill=MUTED)
            tx = indent + 34
        else:
            sq = 11 if level == 0 else 8
            cy = y + (fnt.size // 2)
            mark = ACCENT if level == 0 else ACCENT2
            draw.rectangle([indent, cy - sq//2, indent + sq, cy + sq//2], fill=mark)
            tx = indent + sq + 22
        for i, ln in enumerate(lines):
            draw.text((tx, y), ln, font=fnt, fill=color)
            y += fnt.size + 12
        y += 20 if level == 0 else 12
    return y

def save(img, idx):
    path = os.path.join(HERE, f"slide-{idx:02d}.jpg")
    img.save(path, "JPEG", quality=92)
    return path

# ----------------------------------------------------------------------------
slides = []

# 1 — Title
def slide_title(idx, total):
    img, d = new_canvas()
    # big accent side block
    d.rectangle([0, 0, 26, H], fill=ACCENT)
    d.rectangle([26, 0, 46, H], fill=ACCENT2)
    d.text((MARGIN_X, 360), "Login", font=BIG, fill=INK)
    d.text((MARGIN_X, 480), "Sign-in & Authentication", font=font(F_ARIAL_B, 46), fill=ACCENT)
    d.line([(MARGIN_X, 560), (MARGIN_X + 360, 560)], fill=RULE, width=3)
    d.text((MARGIN_X, 590),
           "Authenticate an existing user, establish a session,",
           font=BODY, fill=INK)
    d.text((MARGIN_X, 634),
           "resolve the acting account + role.", font=BODY, fill=INK)
    d.text((MARGIN_X, 720), "rupng  ·  auth service  ·  spec", font=SUB, fill=MUTED)
    d.text((W - MARGIN_X - text_w(SMALL, "2026"), H - 60), "2026", font=SMALL, fill=MUTED)
    return save(img, idx)
slides.append(slide_title)

# 2 — Objective
def slide_objective(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Overview")
    title_block(d, "Objective")
    items = [
        (0, "Authenticate an existing user and establish a session.", "lead"),
        (0, "identify  →  verify credential  →  MFA (if required)  →  issue token  →  resolve acting account + role", ""),
        (0, "The recurring counterpart to the one-time Registration flow.", ""),
        (0, "Architecture (Cognito, the Lambda authorizer, the light JWT, sessions, revocation, rate limiting) lives in the auth README.", ""),
        (0, "This spec is the sign-in flow and its sub-flows: MFA, reset, identity linking, lockout.", "note"),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_objective)

# 3 — Roles & boundaries
def slide_roles(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Roles & boundaries")
    title_block(d, "Who owns what")
    items = [
        (0, "auth (this flow)", "lead"),
        (1, "sign-in across methods, MFA challenge / step-up, session issue / refresh / revoke, account & role switching, password reset, identity linking, lockout.", ""),
        (0, "Cognito — the credential authority", "lead"),
        (1, "password hashes, social / SAML / OIDC federation, TOTP / SMS MFA.", ""),
        (0, "account — membership + role grants (Auth.RoleGrant)", "lead"),
        (1, "login reads the resolved grant; it doesn't own it.", ""),
        (0, "Models live in the Auth namespace: UserProfile, UserIdentity / AuthMethod, Session, JwtClaims, Context, PasswordPolicy, MfaConfig.", "note"),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_roles)

# 4 — Sign-in methods
def slide_methods(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Sign-in methods")
    title_block(d, "How a user signs in")
    items = [
        (0, "A single user may hold several methods — the screen offers whatever they've linked.", "lead"),
        (0, "Email + password  —  Cognito-native (+ MFA).", ""),
        (0, "Social SSO  —  Google, Microsoft via Cognito federation; provider-verified email.", ""),
        (0, "Enterprise SSO  —  SAML / OIDC per-account SsoConnection, domain-routed, optional JIT provisioning + SCIM.", ""),
        (0, "Passkey / WebAuthn, Magic link  —  reserved in AuthMethod; later.", ""),
        (0, "See Auth.AuthMethod + Auth.UserIdentity.", "note"),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_methods)

# 5 — The flow (diagram)
def slide_flow(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "The flow")
    title_block(d, "Sign-in sequence")
    diagram = [
        " identify (email / SSO) ──► authenticate (Cognito)",
        "        │                        │ fail → lockout tracking",
        "        │                        ▼",
        "        │                 MFA required? ──yes──► challenge (TOTP/SMS) ──ok──┐",
        "        │                        │ no                                       │",
        "        │                        └────────────────────────────────────────┤",
        "        ▼                                                                   ▼",
        " (enumeration-neutral —              issue SESSION → light JWT (identity only)",
        "  same response whether or           resolve acting ACCOUNT + ROLE (≤ max)",
        "  not the email exists)              → return Auth.Context",
    ]
    panel_top, panel_bot = 250, 250 + len(diagram) * 38 + 60
    d.rectangle([MARGIN_X, panel_top, W - MARGIN_X, panel_bot], fill=PANEL)
    d.rectangle([MARGIN_X, panel_top, MARGIN_X + 10, panel_bot], fill=ACCENT)
    y = panel_top + 30
    for line in diagram:
        d.text((MARGIN_X + 44, y), line, font=MONO, fill=INK)
        y += 38
    d.text((MARGIN_X, panel_bot + 28),
           "The JWT is identity-only — roles are resolved per request by the authorizer, so a role change needs no re-issue.",
           font=SUB, fill=MUTED)
    return save(img, idx)
slides.append(slide_flow)

# 6 — MFA
def slide_mfa(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Multi-factor auth")
    title_block(d, "MFA")
    items = [
        (0, "The Cognito MFA setting is OPTIONAL; we enforce the requirement ourselves per Auth.MfaConfig.", "lead"),
        (0, "Step-up when elevating — signing in at, or switching up to, a higher role.", ""),
        (0, "Adaptive on an anomalous sign-in — new device / geo / impossible-travel.", ""),
        (0, "Remember-device — a trusted device may skip MFA for a window (Auth.DeviceInfo.trusted).", ""),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_mfa)

# 7 — Sessions
def slide_sessions(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Sessions")
    title_block(d, "Session lifecycle")
    items = [
        (0, "Issue on success — the Auth.Session record exists so a stateless JWT can be revoked.", ""),
        (0, "Refresh with rotation — reuse of a retired refresh token revokes the whole family (theft signal via refreshFamilyId / refreshGeneration).", ""),
        (0, "Switch account / role — re-scope the session to another granted account (≤ max), audited.", ""),
        (0, "Logout / revoke — blacklist the jti / session; the revocation epoch invalidates cached authorizer allows immediately, with no wait on the JWT TTL.", ""),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_sessions)

# 8 — Identity linking
def slide_linking(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Identity linking")
    title_block(d, "Link, never fork")
    items = [
        (0, "A user accumulates methods over time — we link them to one user, never fork a second account.", "lead"),
        (0, "An SSO sign-in whose verified email matches an existing user attaches a new UserIdentity (after verifying control) — and the reverse (a password user later 'Connect Google').", ""),
        (0, "From settings: add a password, connect / disconnect SSO, manage passkeys — each adds or removes a UserIdentity.", ""),
        (0, "You cannot remove the last method — that would lock the user out.", ""),
        (0, "Registration defers here when it detects an existing email.", "note"),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_linking)

# 9 — Failed login & lockout
def slide_lockout(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Failed login")
    title_block(d, "Lockout & abuse")
    items = [
        (0, "Track failedLogins; progressive backoff leads to a temporary lock (lockedUntil, status LOCKED).", ""),
        (0, "Bot challenge (Turnstile / hCaptcha) after repeated failures.", ""),
        (0, "Breached-password check at login — if the credential is known-compromised, force a reset (credential-stuffing defense).", ""),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_lockout)

# 10 — Reset
def slide_reset(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Recovery")
    title_block(d, "Password reset / forgot")
    items = [
        (0, "Request  →  email a time-boxed, single-use reset link / code.", ""),
        (0, "Set a new password — enforce policy + breached-password check.", ""),
        (0, "Revoke existing sessions — a reset means 'lock everyone else out'.", ""),
        (0, "Enumeration-neutral — the same 'if that email exists, we sent a link' response regardless.", ""),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_reset)

# 11 — Security posture
def slide_security(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Security posture")
    title_block(d, "Defense in depth")
    items = [
        (0, "Enumeration-neutral across login, reset, and registration — never reveal whether an email or phone is registered (same message and timing).", "lead"),
        (0, "Rate-limited per IP + per identity (the platform limiter).", ""),
        (0, "Breached-password rejection.", ""),
        (0, "MFA + adaptive step-up.", ""),
        (0, "Audit every login / switch / reset / link (Auth.AuditEvent).", ""),
    ]
    render_bullets(d, items)
    return save(img, idx)
slides.append(slide_security)

# 12 — Open decisions
def slide_open(idx, total):
    img, d = new_canvas()
    chrome(d, idx, total, "Open decisions")
    title_block(d, "Still to decide")
    decisions = [
        "Account-enumeration posture — strict neutral vs. friendlier 'not found'. Default neutral.",
        "Remember-device window — how long; revoke-on-password-change.",
        "Passwordless / magic link — a primary method, or recovery-only?",
        "Passkey / WebAuthn rollout — when, and second factor vs. primary?",
        "Step-up triggers — which actions / roles force re-auth beyond login.",
        "Enterprise SSO enforcement — may an account require SSO (block password login)?",
    ]
    y = 250
    for i, txt in enumerate(decisions, 1):
        # number chip
        d.ellipse([MARGIN_X, y, MARGIN_X + 44, y + 44], fill=ACCENT)
        nstr = str(i)
        d.text((MARGIN_X + 22 - text_w(LEAD, nstr)/2, y + 4), nstr, font=LEAD, fill=WHITE)
        lines = wrap(d, txt, BODY, W - MARGIN_X*2 - 90)
        ty = y + 2
        for ln in lines:
            d.text((MARGIN_X + 72, ty), ln, font=BODY, fill=INK)
            ty += BODY.size + 8
        y = max(ty, y + 56) + 18
    return save(img, idx)
slides.append(slide_open)

# ----------------------------------------------------------------------------
total = len(slides)
paths = [fn(i + 1, total) for i, fn in enumerate(slides)]
print(f"Rendered {len(paths)} slides:")
for p in paths:
    print(" ", os.path.basename(p))
