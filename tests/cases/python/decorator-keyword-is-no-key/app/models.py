from pydantic import BaseModel, model_validator


class Widget(BaseModel):
    size: int

    @model_validator(mode="before")
    @classmethod
    def fill(cls, data):
        return data
