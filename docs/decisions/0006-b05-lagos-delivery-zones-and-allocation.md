# ADR 0006: B05 Lagos delivery zones and mixed-seller allocation

Status: accepted for B05 local and pilot implementation, 2026-10-25

The owner approved Lagos-only, company-arranged delivery through admin-managed zones and separate seller fulfilment. Delivery is charged once per distinct seller represented in the basket, not once per item. Multiple items from one seller form one fulfilment group. The customer-visible delivery total is the sum of the snapshotted fee for every seller fulfilment group:

`delivery_total_minor = active_zone.fee_minor * distinct_seller_count`

Each seller suborder receives one zone-fee allocation for order accounting. The company retains all delivery fees; delivery is excluded from item commission and seller earnings. One checkout uses either delivery or pickup, never both. Addresses outside an active Lagos zone are rejected.

## Initial standard-delivery zones

The initial values are conservative, admin-editable launch defaults for standard small-parcel delivery. They are not a courier quotation, contract, or guaranteed same-day service.

| Method or zone | Included destinations | Fee per seller group | Stored minor units | Estimate |
|---|---|---:|---:|---|
| Pickup | `Legit Hair Lagos Pickup Hub`; the production street address must be supplied before activation. Local/test data uses `1 Synthetic Dispatch Road, Ikeja, Lagos` and must never be presented as a real address. | ₦0 | 0 | Ready 1–3 business days after every seller item reaches the pickup location |
| Zone 1 — Central Lagos | Agege, Ifako-Ijaiye, Ikeja, Kosofe, Lagos Mainland, Mushin, Oshodi-Isolo, Shomolu and Surulere LGAs; representative areas include Anthony, Gbagada, Ilupeju, Ketu, Maryland, Ogba, Ojota, Omole, Oshodi, Surulere and Yaba. | ₦4,500 | 450000 | 1–2 business days |
| Zone 2 — Extended Lagos | Ajeromi-Ifelodun, Alimosho, Amuwo-Odofin, Apapa, Eti-Osa and Lagos Island LGAs; representative areas include Ajah, Apapa, Festac, Ikoyi, Lagos Island, Lekki Phase 1, Oniru and Victoria Island. | ₦6,000 | 600000 | 2–3 business days |
| Zone 3 — Outer Lagos | Badagry, Epe, Ibeju-Lekki, Ikorodu and Ojo LGAs; representative areas include Awoyaya, Badagry, Epe, Ibeju-Lekki, Ikorodu and Sangotedo. | ₦8,000 | 800000 | 2–4 business days |

All 20 Lagos LGAs appear in exactly one initial delivery zone. An admin may change coverage, fees and estimates or deactivate a zone. Existing quotes and later orders retain immutable snapshots; configuration changes affect only new quotes. An address must declare Lagos State and resolve unambiguously to an active zone. Free-form text alone must not silently select a cheaper zone.

Pickup is available only when every seller group can be consolidated at the selected active pickup location. The API must not offer the placeholder production pickup location as active. B05 may use the explicitly synthetic pickup record in guarded local and test environments.

Example: a Zone 2 basket with three products from seller A and one product from seller B has two fulfilment groups. Each group receives a ₦6,000 allocation and the customer sees a ₦12,000 delivery total. Item commission is calculated without that ₦12,000.

## Pricing basis and review

Public Lagos pricing checked on 2026-10-25 shows substantial variation by origin, destination, service level and volume. Nomad advertises Lagos delivery from ₦2,500 and, in a time-limited multi-drop promotion, ₦3,000 for central mainland and ₦4,000 for core island drops. Maucare publishes area rates from ₦3,000 to ₦7,000. TravelShopNG publishes indicative standard rates of ₦4,500 for core mainland, ₦6,000 for mainland outskirts and ₦8,000 for farther outskirts. These sources justify the initial bands but do not replace a quote from the delivery operator actually selected by Legit Hair:

- https://www.nomadlogisticsolutions.com/
- https://maucare.com.ng/delivery
- https://travelshopng.com/policies/shipping-policy

Before production activation, the owner must supply the real pickup street address and confirm the fees and estimates against the chosen operator's written quotation. Admin configurability is not permission to activate an invented address. Failed-delivery charges, redelivery, returns and COD eligibility remain separate policy decisions for their dependent milestones.
