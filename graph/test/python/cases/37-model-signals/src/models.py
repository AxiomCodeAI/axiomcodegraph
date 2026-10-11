"""Model signals the ORM sends from inside save() and delete() on the client's behalf.

The client never writes a `send` for these: `Order.objects.create(...)` and
`order.save()` fire post_save with sender=Order. A receiver is scoped by `sender=`.
"""
from django.db import models
from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver


class Order(models.Model):
    name = models.CharField(max_length=40)


class Invoice(models.Model):
    total = models.IntegerField(default=0)


def audit_order(sender, instance, created, **kwargs):
    return instance


post_save.connect(audit_order, sender=Order)


@receiver(pre_delete, sender=Order)
def before_order_delete(sender, instance, **kwargs):
    return instance


@receiver(post_save, sender=Invoice)
def audit_invoice(sender, instance, **kwargs):
    return instance
