import inspect
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from garminconnect import Garmin
from supabase import Client, create_client


def require_env(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val:
        raise RuntimeError(f"Gerekli ortam değişkeni eksik: {name}")
    return val


def to_float(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def to_int(val: Any) -> Optional[int]:
    if val is None or val == "":
        return None
    try:
        return int(round(float(val)))
    except (TypeError, ValueError):
        return None


def build_garmin_kwargs(api: Garmin, row: Dict[str, Any]) -> Dict[str, Any]:
    """Build add_body_composition arguments compatible with the installed garminconnect version."""
    weight = to_float(row.get("weight_kg"))
    if weight is None or weight <= 0:
        raise ValueError("Geçerli bir weight_kg değeri bulunamadı.")

    raw_ts = str(row.get("measured_at") or datetime.now(timezone.utc).isoformat()).strip()
    candidate_kwargs: Dict[str, Any] = {
        "timestamp": raw_ts,
        "weight": weight,
        "percent_fat": to_float(row.get("body_fat_pct")),
        "percent_hydration": to_float(row.get("body_water_pct")),
        "bone_mass": to_float(row.get("bone_mass_kg")),
        "muscle_mass": to_float(row.get("muscle_mass_kg")),
        "basal_met": to_int(row.get("bmr_kcal")),
        "metabolic_age": to_int(row.get("metabolic_age")),
        "visceral_fat_rating": to_float(row.get("visceral_fat")),
        "bmi": to_float(row.get("bmi")),
    }

    non_null = {k: v for k, v in candidate_kwargs.items() if v is not None}

    sig = inspect.signature(api.add_body_composition)
    accepts_var_kw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
    if accepts_var_kw:
        return non_null
    return {k: v for k, v in non_null.items() if k in sig.parameters}


def get_disabled_auto_sync_users(supabase: Client) -> Set[str]:
    resp = supabase.table("user_settings").select("user_id, garmin_auto_sync_scale").execute()
    disabled: Set[str] = set()
    for row in resp.data or []:
        if row.get("garmin_auto_sync_scale") is False and row.get("user_id"):
            disabled.add(str(row["user_id"]))
    return disabled


def main() -> int:
    try:
        supabase_url = require_env("SUPABASE_URL")
        supabase_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
        garmin_email = require_env("GARMIN_EMAIL")
        garmin_password = require_env("GARMIN_PASSWORD")
    except RuntimeError as exc:
        print(f"[HATA] {exc}", file=sys.stderr)
        return 1

    supabase = create_client(supabase_url, supabase_key)
    disabled_users = get_disabled_auto_sync_users(supabase)

    pending_resp = (
        supabase.table("body_composition")
        .select("*")
        .eq("garmin_synced", False)
        .order("measured_at", desc=False)
        .execute()
    )
    all_pending: List[Dict[str, Any]] = pending_resp.data or []
    eligible = [r for r in all_pending if str(r.get("user_id") or "") not in disabled_users]

    if not eligible:
        print(
            f"Aktarılacak uygun kayıt yok (toplam bekleyen={len(all_pending)}, otomatik senkronu kapatan={len(disabled_users)})."
        )
        return 0

    print(f"Toplam {len(eligible)} kayıt Garmin Connect'e aktarılacak...")
    api = Garmin(garmin_email, garmin_password)
    try:
        api.login()
    except Exception as exc:
        err_msg = f"Garmin Connect giriş hatası: {str(exc)[:420]}"
        print(f"[HATA] {err_msg}", file=sys.stderr)
        for row in eligible:
            supabase.table("body_composition").update({"garmin_sync_error": err_msg}).eq("id", row["id"]).execute()
        return 1

    success_count = 0
    error_count = 0

    for row in eligible:
        rec_id = row["id"]
        try:
            kwargs = build_garmin_kwargs(api, row)
            api.add_body_composition(**kwargs)
            now_iso = datetime.now(timezone.utc).isoformat()
            supabase.table("body_composition").update(
                {
                    "garmin_synced": True,
                    "garmin_synced_at": now_iso,
                    "garmin_sync_error": None,
                }
            ).eq("id", rec_id).execute()
            success_count += 1
            print(f"[OK] {rec_id} ({row.get('measured_at')} · {row.get('weight_kg')} kg) Garmin'e aktarıldı.")
        except Exception as exc:
            error_count += 1
            err_msg = str(exc)[:500]
            print(f"[HATA] {rec_id}: {err_msg}", file=sys.stderr)
            supabase.table("body_composition").update({"garmin_sync_error": err_msg}).eq("id", rec_id).execute()

    print(f"Tamamlandı -> Başarılı: {success_count}, Hatalı: {error_count}")
    return 0 if error_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
