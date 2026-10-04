"""Server-side pricing: print weight × price per gram + flat shipping (FR-CHK-04)."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from optiframe.catalog import MATERIALS
from optiframe.config import Settings

CENT = Decimal("0.01")


@dataclass(frozen=True)
class PriceBreakdown:
    material: str
    grams: float
    price_per_g: Decimal
    material_cents: int
    shipping_cents: int
    discount_cents: int
    total_cents: int
    currency: str
    sponsored: bool

    def as_quote(self) -> dict:
        return {
            "material": self.material, "grams": self.grams, "price_per_g": float(self.price_per_g),
            "material_cost": self.material_cents / 100, "shipping": self.shipping_cents / 100,
            "discount": self.discount_cents / 100, "total": self.total_cents / 100,
            "currency": self.currency, "sponsored": self.sponsored,
        }


def _cents(amount: Decimal) -> int:
    return int((amount.quantize(CENT, rounding=ROUND_HALF_UP) * 100).to_integral_value())


def price(volume_mm3: float, material: str, settings: Settings, *, sponsored: bool = False) -> PriceBreakdown:
    m = MATERIALS[material]
    grams = (Decimal(str(volume_mm3)) / Decimal(1000) * m["density"]).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    material_cents = _cents(grams * m["price_per_g"])
    shipping_cents = _cents(settings.shipping_flat)
    subtotal = material_cents + shipping_cents
    discount = subtotal if sponsored else 0
    return PriceBreakdown(
        material=material, grams=float(grams), price_per_g=m["price_per_g"], material_cents=material_cents,
        shipping_cents=shipping_cents, discount_cents=discount, total_cents=subtotal - discount,
        currency=settings.currency, sponsored=sponsored,
    )
