"""Cabeçalhos de segurança aplicados a todas as respostas (inclusive às de erro 500)."""

from starlette.datastructures import MutableHeaders

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    ),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
}


def apply_security_headers(headers: MutableHeaders, *, skip_csp: bool = False) -> None:
    """Acrescenta os cabeçalhos que ainda não existem; `skip_csp` só para a documentação."""
    for name, value in SECURITY_HEADERS.items():
        if name == "Content-Security-Policy" and skip_csp:
            continue
        headers.setdefault(name, value)
