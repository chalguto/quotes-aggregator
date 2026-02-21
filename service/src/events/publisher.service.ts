import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';
import { v4 as uuidv4 } from 'uuid';

/**
 * Azure Service Bus publisher for QuoteIssued domain events.
 *
 * - Uses connection string in local / CI environments.
 * - Uses DefaultAzureCredential (Workload Identity) on AKS.
 * - If neither is configured, events are silently skipped.
 * - All errors are caught and logged — publishing never blocks the HTTP response.
 */
@Injectable()
export class PublisherService implements OnApplicationShutdown {
  private readonly logger = new Logger(PublisherService.name);
  private client: ServiceBusClient | null = null;
  private sender: ServiceBusSender | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getSender(): ServiceBusSender | null {
    if (this.sender) return this.sender;

    const connectionString = this.configService.get<string>(
      'serviceBus.connectionString',
    );
    const namespace = this.configService.get<string>('serviceBus.namespace');
    const topicName =
      this.configService.get<string>('serviceBus.topicName') ?? 'quotes.issued';

    if (connectionString) {
      this.client = new ServiceBusClient(connectionString);
      this.logger.log('ServiceBus client initialised via connection string');
    } else if (namespace) {
      this.client = new ServiceBusClient(
        `${namespace}.servicebus.windows.net`,
        new DefaultAzureCredential(),
      );
      this.logger.log(`ServiceBus client initialised via Managed Identity (${namespace})`);
    } else {
      this.logger.warn('ServiceBus not configured — QuoteIssued events will be skipped');
      return null;
    }

    this.sender = this.client.createSender(topicName);
    return this.sender;
  }

  async publishQuoteIssued(
    quote: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<void> {
    const sender = this.getSender();
    if (!sender) return;

    const event = {
      eventId: uuidv4(),
      eventType: 'com.example.quotes.QuoteIssued',
      eventVersion: '1.0',
      source: 'quotes-aggregator',
      time: new Date().toISOString(),
      idempotencyKey: idempotencyKey ?? null,
      data: {
        quoteId: quote['quoteId'],
        documentId: quote['documentId'],
        documentType: quote['documentType'],
        insuredName: quote['insuredName'],
        insuredEmail: quote['insuredEmail'],
        coverageAmount: quote['coverageAmount'],
        currency: quote['currency'],
        premium: quote['premium'],
        status: quote['status'],
        effectiveDate: quote['effectiveDate'],
        expiryDate: quote['expiryDate'],
        createdAt: quote['createdAt'],
      },
    };

    try {
      await sender.sendMessages({
        body: event,
        contentType: 'application/json',
        messageId: event.eventId,
        applicationProperties: {
          eventType: event.eventType,
          status: event.data.status,
        },
      });
      this.logger.log(`QuoteIssued published quoteId=${quote['quoteId']}`);
    } catch (err) {
      this.logger.error('Failed to publish QuoteIssued event', (err as Error).message);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.sender?.close();
      await this.client?.close();
    } catch {
      // Ignore shutdown errors
    }
  }
}
