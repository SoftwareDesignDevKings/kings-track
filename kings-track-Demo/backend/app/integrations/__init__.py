from app.integrations.edstem import edstem_client
from app.integrations.gradeo import gradeo_client

INTEGRATIONS = [edstem_client, gradeo_client]

__all__ = ["edstem_client", "gradeo_client", "INTEGRATIONS"]
