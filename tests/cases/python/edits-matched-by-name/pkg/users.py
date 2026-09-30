from pkg.fields import HStoreField, CharField


def build():
    return [HStoreField().run(), CharField().run()]
