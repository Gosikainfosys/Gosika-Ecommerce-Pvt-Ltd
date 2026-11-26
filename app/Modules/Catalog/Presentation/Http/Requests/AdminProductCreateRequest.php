<?php

namespace App\Modules\Catalog\Presentation\Http\Requests;

use App\Modules\Shared\Domain\Enums\ProductStatus;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class AdminProductCreateRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        $meta = $this->input('meta');

        if (is_string($meta)) {
            $decoded = json_decode($meta, true);

            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                $this->merge(['meta' => $decoded]);
            }
        }
    }

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $vendorId = Vendor::query()->where('uuid', $this->input('vendor_id'))->value('id');

        return [
            'vendor_id' => ['required', 'string', 'exists:vendors,uuid'],
            'store_id' => ['required', 'string', 'exists:stores,uuid'],
            'name' => ['required', 'string', 'max:200'],
            'slug' => ['nullable', 'string', 'max:220', 'regex:/^[a-z0-9-]+$/'],
            'description' => ['nullable', 'string'],
            'short_description' => ['nullable', 'string', 'max:1000'],
            'category_id' => ['nullable', 'string', 'exists:categories,uuid'],
            'brand_id' => ['nullable', 'string', 'exists:brands,uuid'],
            'sku' => [
                'nullable',
                'string',
                'max:80',
                Rule::unique('products', 'sku')->where(fn ($query) => $query->where('vendor_id', $vendorId)),
            ],
            'barcode' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', Rule::enum(ProductStatus::class)],
            'quantity' => ['required', 'integer', 'min:0'],
            'low_stock_threshold' => ['nullable', 'integer', 'min:0'],
            'price' => ['required', 'numeric', 'min:0'],
            'compare_at_price' => ['nullable', 'numeric', 'min:0'],
            'cost_price' => ['nullable', 'numeric', 'min:0'],
            'weight_grams' => ['nullable', 'integer', 'min:0'],
            'dimensions' => ['nullable', 'string', 'max:60'],
            'hs_code' => ['nullable', 'string', 'max:20'],
            'tax_rate' => ['nullable', 'integer', 'min:0', 'max:100'],
            'manufacturer' => ['nullable', 'string', 'max:255'],
            'is_variant' => ['nullable', 'boolean'],
            'is_featured' => ['nullable', 'boolean'],
            'is_negotiable' => ['nullable', 'boolean'],
            'meta' => ['nullable', 'array'],
            'variants_present' => ['nullable', 'boolean'],
            'variants' => ['nullable', 'array'],
            'variants.*.sku' => ['nullable', 'string', 'max:80', 'distinct'],
            'variants.*.name' => ['nullable', 'string', 'max:200'],
            'variants.*.price' => ['required_with:variants', 'numeric', 'min:0'],
            'variants.*.compare_at_price' => ['nullable', 'numeric', 'min:0'],
            'variants.*.quantity' => ['nullable', 'integer', 'min:0'],
            'variants.*.options' => ['nullable', 'array'],
            'variants.*.options.*' => ['nullable', 'string', 'max:255'],
            'variants.*.image' => ['nullable', 'image', 'max:5120'],
            'attributes' => ['nullable', 'array'],
            'attributes.*.name' => ['required_with:attributes', 'string', 'max:80'],
            'attributes.*.type' => ['nullable', 'string', 'in:text,select,color,size'],
            'attributes.*.values' => ['nullable', 'array'],
            'attributes.*.values.*' => ['nullable', 'string', 'max:255'],
            'images' => ['nullable', 'array', 'max:10'],
            'images.*' => ['nullable', 'image', 'max:5120'],
            'image_urls' => ['nullable', 'array', 'max:10'],
            'image_urls.*' => ['required', 'url', 'max:2048'],
            'primary_image_url' => ['nullable', 'string', 'max:2048', 'regex:/^(https?:\/\/|\/?storage\/|[a-z0-9_-]+\/)[^\s]+$/i'],
            'primary_image_upload_index' => ['nullable', 'integer', 'min:0'],
            'image_url' => ['nullable', 'url', 'max:2048'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $uploadedImages = $this->file('images', []);
            $uploadedCount = is_array($uploadedImages) ? count($uploadedImages) : (int) (bool) $uploadedImages;
            $imageUrls = $this->input('image_urls', []);
            $urlCount = is_array($imageUrls) ? count($imageUrls) : (int) (bool) $imageUrls;

            if ($urlCount === 0 && $this->filled('image_url')) {
                $urlCount = 1;
            }

            if ($uploadedCount + $urlCount > 10) {
                $validator->errors()->add('images', 'Add no more than 10 product images.');
            }

            $primaryUploadIndex = $this->input('primary_image_upload_index');
            if ($primaryUploadIndex !== null && (int) $primaryUploadIndex >= $uploadedCount) {
                $validator->errors()->add('primary_image_upload_index', 'Choose a primary image from the uploaded files.');
            }
        });
    }

    public function messages(): array
    {
        return [
            'sku.unique' => 'This SKU is already used by another product for this vendor.',
            'images.*.image' => 'Each product image must be a valid image file.',
            'images.*.max' => 'Each product image must be 5 MB or smaller.',
            'image_urls.*.url' => 'Enter a valid image URL starting with https://.',
        ];
    }
}
