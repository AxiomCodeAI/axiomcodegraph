from django.urls import path

from catalog import views

urlpatterns = [
    path("", views.catalog_index),
]
