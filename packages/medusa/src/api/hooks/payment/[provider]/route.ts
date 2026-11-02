import { PaymentModuleOptions } from "@medusajs/framework/types"
import {
  MedusaError,
  Modules,
  PaymentWebhookEvents,
} from "@medusajs/framework/utils"

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { provider } = req.params

    const paymentService = req.scope.resolve(Modules.PAYMENT)
    const providerId = provider.startsWith("pp_") ? provider : `pp_${provider}`
    const paymentProviders = await paymentService.listPaymentProviders({
      id: providerId,
      is_enabled: true,
    })

    if (!paymentProviders.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Payment provider ${providerId} is not configured`
      )
    }

    const options: PaymentModuleOptions =
      // @ts-expect-error "Not sure if .options exists on a module"
      paymentService.options || {}

    const event = {
      provider,
      payload: { data: req.body, rawData: req.rawBody, headers: req.headers },
    }

    const eventBus = req.scope.resolve(Modules.EVENT_BUS)

    // We delay the processing of the event to avoid a conflict caused by a race condition.
    // The provider has been told the event was received (200 below) and won't send it
    // again, so processing must outlast short outages of the provider or the database:
    // retry with exponential backoff rather than a few immediate attempts.
    await eventBus.emit(
      {
        name: PaymentWebhookEvents.WebhookReceived,
        data: event,
      },
      {
        delay: options.webhook_delay || 5000,
        attempts: options.webhook_retries || 10,
        backoff: {
          type: "exponential",
          delay: options.webhook_retry_delay || 2000,
        },
      }
    )
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`)
    return
  }

  res.sendStatus(200)
}
