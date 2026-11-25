<?php

namespace App\Modules\Payment\Infrastructure\Services;

use App\Modules\Payment\Domain\Contracts\PaymentProviderContract;
use App\Modules\Payment\Domain\Exceptions\PaymentProviderException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

class EsewaProvider implements PaymentProviderContract
{
    public function __construct(
        protected string $secretKey,
        protected string $productCode,
        protected string $formUrl,
        protected string $statusUrl,
        protected string $successUrl,
        protected string $failureUrl
    ) {
    }

    public function name(): string
    {
        return 'esewa';
    }

    public function initiate(array $payload): array
    {
        $total = (float) ($payload['total_amount'] ?? 0);
        $totalAmountStr = $this->formatAmount($total);

        // Standard payment gateway practice for eSewa: send the full payable grand total as amount,
        // with 0 for sub-charges, ensuring eSewa collects the exact total without IRD tax lookup crashes.
        $amountStr = $totalAmountStr;
        $taxAmountStr = '0';
        $serviceChargeStr = '0';
        $deliveryChargeStr = '0';

        $transactionUuid = preg_replace('/[^a-zA-Z0-9\-]/', '', (string) ($payload['transaction_uuid'] ?? ''));
        $productCode = (string) ($payload['product_code'] ?? $this->productCode);

        if ($transactionUuid === '' || $productCode === '' || $this->secretKey === '') {
            throw new PaymentProviderException('eSewa payment is not configured.', 422);
        }

        $signedFieldNames = 'total_amount,transaction_uuid,product_code';
        $signedString = 'total_amount='.$totalAmountStr.',transaction_uuid='.$transactionUuid.',product_code='.$productCode;

        return [
            'action' => $this->formUrl,
            'fields' => [
                'amount' => $amountStr,
                'tax_amount' => $taxAmountStr,
                'total_amount' => $totalAmountStr,
                'transaction_uuid' => $transactionUuid,
                'product_code' => $productCode,
                'product_service_charge' => $serviceChargeStr,
                'product_delivery_charge' => $deliveryChargeStr,
                'success_url' => (string) ($payload['success_url'] ?? $this->successUrl),
                'failure_url' => (string) ($payload['failure_url'] ?? $this->failureUrl),
                'signed_field_names' => $signedFieldNames,
                'signature' => $this->sign($signedString, $this->secretKey),
            ],
        ];
    }

    public function lookup(string $transactionUuid, ?array $params = null): array
    {
        $totalAmount = $this->formatAmount((float) ($params['total_amount'] ?? 0));

        try {
            $response = Http::timeout(20)->get($this->statusUrl, [
                'product_code' => $this->productCode,
                'total_amount' => $totalAmount,
                'transaction_uuid' => $transactionUuid,
            ]);
        } catch (ConnectionException) {
            throw new PaymentProviderException('eSewa status service is currently unavailable (connection timeout).', 502);
        }

        $data = $response->json();

        if (! is_array($data)) {
            throw new PaymentProviderException('eSewa status returned an invalid response.', 502);
        }

        if (isset($data['error_message']) && $data['error_message'] === 'Service is currently unavailable') {
            throw new PaymentProviderException('eSewa status service is currently unavailable.', 503);
        }

        return $data;
    }

    /**
     * Initiate a refund via the eSewa Refund API.
     *
     * eSewa refund endpoint: POST {base}/epay/transaction/refund/
     * Required signed fields: total_amount,transaction_uuid,product_code
     *
     * @param  string  $transactionUuid  The original payment transaction UUID (payment_number).
     * @param  float   $amount           Amount to refund (in NPR).
     * @return array   eSewa refund response — includes 'status' (FULL_REFUND|PARTIAL_REFUND) and 'ref_id'.
     *
     * @throws PaymentProviderException
     */
    public function refund(string $transactionUuid, float $amount): array
    {
        $refundUrl = $this->resolveRefundUrl();
        $totalAmountStr = $this->formatAmount($amount);
        $productCode = $this->productCode;

        if ($transactionUuid === '' || $productCode === '' || $this->secretKey === '') {
            throw new PaymentProviderException('eSewa refund is not configured.', 422);
        }

        $signedFieldNames = 'total_amount,transaction_uuid,product_code';
        $signedString = 'total_amount='.$totalAmountStr.',transaction_uuid='.$transactionUuid.',product_code='.$productCode;

        $payload = [
            'total_amount'       => $totalAmountStr,
            'transaction_uuid'   => $transactionUuid,
            'product_code'       => $productCode,
            'signed_field_names' => $signedFieldNames,
            'signature'          => self::sign($signedString, $this->secretKey),
        ];

        try {
            $response = Http::timeout(30)->post($refundUrl, $payload);
        } catch (ConnectionException) {
            throw new PaymentProviderException('eSewa refund service is currently unavailable (connection timeout).', 502);
        }

        $data = $response->json();

        if (! is_array($data)) {
            throw new PaymentProviderException('eSewa refund returned an invalid response.', 502);
        }

        if (isset($data['error_message'])) {
            throw new PaymentProviderException('eSewa refund error: '.(string) $data['error_message'], 422);
        }

        if ($response->clientError() || $response->serverError()) {
            throw new PaymentProviderException(
                'eSewa refund failed (HTTP '.$response->status().'): '.$response->body(),
                $response->status()
            );
        }

        return $data;
    }

    /**
     * Derive the refund URL from the status URL.
     * Status URL:  https://rc.esewa.com.np/api/epay/transaction/status/
     * Refund URL:  https://rc.esewa.com.np/api/epay/transaction/refund/
     */
    protected function resolveRefundUrl(): string
    {
        // Replace /status/ with /refund/ — works for both UAT and production base URLs.
        $url = preg_replace('#/status/?$#', '/refund/', rtrim($this->statusUrl, '/'));

        return $url ?? str_replace('/status/', '/refund/', $this->statusUrl);
    }

    protected function formatAmount(float $val): string
    {
        if (floor($val) == $val) {
            return (string) ((int) $val);
        }

        return rtrim(rtrim(number_format($val, 2, '.', ''), '0'), '.');
    }

    public static function sign(string $message, string $secret): string
    {
        return base64_encode(hash_hmac('sha256', $message, $secret, true));
    }

    protected function decode(Response $response, string $action): array
    {
        if ($response->clientError() || $response->serverError()) {
            throw new PaymentProviderException(
                'eSewa '.$action.' failed (HTTP '.$response->status().'): '.$response->body(),
                $response->status()
            );
        }

        $data = $response->json();

        if (! is_array($data)) {
            throw new PaymentProviderException('eSewa '.$action.' returned an invalid response.', 502);
        }

        return $data;
    }
}
