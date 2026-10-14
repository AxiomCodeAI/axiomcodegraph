import json


def to_json(obj):
    return json.dumps(to_dict(obj), sort_keys=True)


def to_dict(obj):
    return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
