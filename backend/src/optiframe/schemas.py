"""Request/response models shared by the API routes."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from optiframe.catalog import ARUCO_DICTIONARIES, ENGRAVING_MAX_CHARS, PARAM_RANGES, Color, Material, Pattern

# ---------------------------------------------------------------------------- measurement


class CreditCardRef(BaseModel):
    type: Literal["credit_card"]


class A4Ref(BaseModel):
    type: Literal["a4"]


class CustomRef(BaseModel):
    type: Literal["custom"]
    width_mm: float = Field(gt=10, le=500)
    height_mm: float = Field(gt=10, le=500)


class ArucoRef(BaseModel):
    type: Literal["aruco"]
    dictionary: str
    marker_size_mm: float = Field(gt=10, le=300)

    @field_validator("dictionary")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in ARUCO_DICTIONARIES:
            raise ValueError(f"unknown ArUco dictionary; expected one of {', '.join(ARUCO_DICTIONARIES)}")
        return v


Reference = Annotated[CreditCardRef | A4Ref | CustomRef | ArucoRef, Field(discriminator="type")]


class Hint(BaseModel):
    box: tuple[float, float, float, float]

    @field_validator("box")
    @classmethod
    def _norm(cls, v):
        x0, y0, x1, y1 = v
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError("hint must be [x0, y0, x1, y1] normalised to 0–1 with x0 < x1 and y0 < y1")
        return v


class BoxMM(BaseModel):
    x_min: float
    x_max: float
    y_min: float
    y_max: float


class LensResult(BaseModel):
    contour_mm: list[tuple[float, float]]
    A: float
    B: float
    perimeter: float
    box_mm: BoxMM
    confidence: float
    accuracy_mm: float
    scale_px_per_mm: float
    rectified_image: str
    rectified_origin_mm: tuple[float, float]


class Warning_(BaseModel):
    code: Literal["LOW_RESOLUTION", "LIKELY_COMPRESSED", "FAINT_EDGE"]
    side: Literal["left", "right"] | None = None
    message: str


class MeasureResponse(BaseModel):
    left: LensResult
    right: LensResult
    asymmetric: bool
    warnings: list[Warning_]


class MeasureLensResponse(BaseModel):
    side: Literal["left", "right"]
    lens: LensResult
    warnings: list[Warning_]


# ---------------------------------------------------------------------------- generation


def _ranged(name: str):
    r = PARAM_RANGES[name]
    return Field(ge=r["min"], le=r["max"])


Contour = Annotated[list[tuple[float, float]], Field(min_length=16, max_length=4000)]


class Design(BaseModel):
    model_config = ConfigDict(extra="forbid")

    left_contour_mm: Contour
    right_contour_mm: Contour
    bridge_mm: float = _ranged("bridge_mm")
    depth_mm: float = _ranged("depth_mm")
    rim_offset_mm: float = _ranged("rim_offset_mm")
    clip_clearance_mm: float = _ranged("clip_clearance_mm")
    pattern: Pattern = "none"
    engraving_text: str = Field(default="", max_length=ENGRAVING_MAX_CHARS)

    @field_validator("engraving_text")
    @classmethod
    def _engraving(cls, v: str) -> str:
        return v.strip()


# ---------------------------------------------------------------------------- commerce


class QuoteRequest(BaseModel):
    volume_mm3: float = Field(gt=0, le=500_000)
    material: Material
    sponsor_code: str | None = None


class Quote(BaseModel):
    material: Material
    grams: float
    price_per_g: float
    material_cost: float
    shipping: float
    discount: float
    total: float
    currency: str
    sponsored: bool


class Address(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=120)
    postal_code: str = Field(min_length=1, max_length=20)
    region: str | None = Field(default=None, max_length=120)
    country: str = Field(min_length=2, max_length=2, description="ISO 3166-1 alpha-2")
    phone: str | None = Field(default=None, max_length=40)

    @field_validator("country")
    @classmethod
    def _upper(cls, v: str) -> str:
        if not v.isalpha():
            raise ValueError("country must be an ISO 3166-1 alpha-2 code")
        return v.upper()


class Payment(BaseModel):
    provider: Literal["fake"] = "fake"
    token: str = Field(min_length=1, max_length=200)


class OrderCreate(BaseModel):
    design: Design
    design_signature: str = Field(min_length=64, max_length=64)
    material: Material
    color: Color
    email: EmailStr
    shipping_address: Address
    payment: Payment | None = None
    sponsor_code: str | None = Field(default=None, max_length=64)


class LensSummary(BaseModel):
    A: float
    B: float


class OrderSpecs(BaseModel):
    left_lens: LensSummary
    right_lens: LensSummary
    bridge_mm: float
    depth_mm: float
    rim_offset_mm: float
    clip_clearance_mm: float
    pattern: str
    engraving_text: str
    material: str
    color: str


class Pricing(BaseModel):
    grams: float
    material_cost: float
    shipping: float
    discount: float
    total: float
    currency: str
    sponsored: bool


class OrderEventOut(BaseModel):
    status: str
    at: datetime
    note: str | None = None


class DeliveryWindow(BaseModel):
    from_: date = Field(serialization_alias="from")
    to: date


class OrderOut(BaseModel):
    order_id: str
    status: str
    created_at: datetime
    email: str
    shipping_address: Address
    specs: OrderSpecs
    pricing: Pricing
    estimated_delivery: DeliveryWindow
    tracking_number: str | None
    can_cancel: bool
    timeline: list[OrderEventOut]


class OrderCreated(OrderOut):
    access_token: str


class OrderClaim(BaseModel):
    order_id: str
    access_token: str


# ---------------------------------------------------------------------------- accounts


class Register(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    name: str | None = Field(default=None, max_length=120)


class Login(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None
    shipping_address: Address | None


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    user: UserOut


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    shipping_address: Address | None = None


# ---------------------------------------------------------------------------- admin


class AdminOrderUpdate(BaseModel):
    status: Literal["printing", "shipped", "delivered"] | None = None
    tracking_number: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=500)


class SponsorCodeCreate(BaseModel):
    sponsor_name: str = Field(min_length=1, max_length=120)
    code: str | None = Field(default=None, min_length=4, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    max_uses: int = Field(ge=1, le=100_000)
    expires_at: datetime | None = None


class SponsorCodeUpdate(BaseModel):
    active: bool


class SponsorCodeOut(BaseModel):
    code: str
    sponsor_name: str
    max_uses: int
    uses: int
    expires_at: datetime | None
    active: bool
    created_at: datetime
