from pydantic import BaseModel, computed_field, validate_call

@validate_call
def apply_discount(price: float) -> float:
    return round(price * 0.9, 2)

def apply_tax(price: float) -> float:
    return round(price * 1.2, 2)

class Order(BaseModel):
    total: float
    @computed_field
    @property
    def grand_total(self) -> float:
        return self.total * 1.2
    @property
    def net_total(self) -> float:
        return self.total
