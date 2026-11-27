<?php

namespace App\Modules\Catalog\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\DataTransferObjects\BrandRequestDTO;
use App\Modules\Catalog\Application\DataTransferObjects\ProductDTO;
use App\Modules\Catalog\Application\Services\CatalogService;
use App\Modules\Catalog\Infrastructure\Models\BrandRequest;
use App\Modules\Catalog\Infrastructure\Models\Product;
use App\Modules\Catalog\Presentation\Http\Requests\BrandRequestCreateRequest;
use App\Modules\Catalog\Presentation\Http\Requests\ProductImageReorderRequest;
use App\Modules\Catalog\Presentation\Http\Requests\ProductRequest;
use App\Modules\Catalog\Presentation\Resources\BrandRequestResource;
use App\Modules\Catalog\Presentation\Resources\ProductResource;
use App\Modules\Identity\Domain\Roles;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;

class VendorProductController extends Controller
{
    public function __construct(protected CatalogService $service)
    {
        $this->middleware('auth:sanctum');
        $this->middleware('role:'.Roles::VENDOR_ADMIN);
    }

    public function index(Request $request): JsonResponse
    {
        $vendor = $this->vendorFor($request);

        $products = Product::query()
            ->where('vendor_id', $vendor->id)
            ->with(['category', 'brand', 'primaryImage', 'variants'])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->status))
            ->when($request->filled('search'), fn ($q) => $q->where('name', 'like', '%'.$request->search.'%'))
            ->orderByDesc('updated_at')
            ->paginate((int) $request->integer('per_page', 20));

        return Response::success(
            ProductResource::collection($products),
            'Products retrieved.',
            [
                'current_page' => $products->currentPage(),
                'per_page' => $products->perPage(),
                'total' => $products->total(),
                'last_page' => $products->lastPage(),
            ]
        );
    }

    public function show(Request $request, string $productId): JsonResponse
    {
        $vendor = $this->vendorFor($request);

        $product = Product::query()
            ->where('vendor_id', $vendor->id)
            ->with(['category', 'brand', 'images', 'variants', 'attributes.values'])
            ->where('uuid', $productId)
            ->first();

        if (! $product) {
            throw new DomainException('Product not found.', 404);
        }

        return Response::success(new ProductResource($product), 'Product retrieved.');
    }

    public function store(ProductRequest $request): JsonResponse
    {
        $product = $this->service->createProduct($request->user(), ProductDTO::fromArray($request->validated()));

        return Response::success(new ProductResource($product), 'Product created.', [], 201);
    }

    public function update(ProductRequest $request, string $productId): JsonResponse
    {
        $vendor = $this->vendorFor($request);
        $product = $this->findOwned($vendor->id, $productId);

        $product = $this->service->updateProduct($request->user(), $product, ProductDTO::fromArray($request->validated()));
        $product->load(['category', 'brand', 'images', 'primaryImage', 'variants', 'attributes.values']);

        return Response::success(new ProductResource($product), 'Product updated.');
    }

    public function reorderImages(ProductImageReorderRequest $request, string $productId): JsonResponse
    {
        $vendor = $this->vendorFor($request);
        $product = $this->findOwned($vendor->id, $productId);
        $images = $product->images()->whereNull('variant_id')->orderBy('sort_order')->get();
        $orderedIds = array_values($request->input('images', []));
        $availableIds = $images->pluck('uuid')->all();
        $primaryId = $request->input('primary_image_id');

        if (count($orderedIds) !== count($availableIds)
            || array_diff($orderedIds, $availableIds)
            || array_diff($availableIds, $orderedIds)) {
            throw new DomainException('Send every product image exactly once when reordering.', 422);
        }

        if ($primaryId && ! in_array($primaryId, $orderedIds, true)) {
            throw new DomainException('The cover image must be part of the product gallery.', 422);
        }

        DB::transaction(function () use ($images, $orderedIds, $primaryId): void {
            $primaryId = $primaryId ?: $orderedIds[0];

            foreach ($orderedIds as $index => $uuid) {
                $images->firstWhere('uuid', $uuid)->update([
                    'sort_order' => $index,
                    'is_primary' => $uuid === $primaryId,
                ]);
            }
        });

        $product->load(['category', 'brand', 'images', 'primaryImage', 'variants', 'attributes.values']);

        return Response::success(new ProductResource($product), 'Product images updated.');
    }

    public function deleteImage(Request $request, string $productId, string $imageId): JsonResponse
    {
        $vendor = $this->vendorFor($request);
        $product = $this->findOwned($vendor->id, $productId);
        $image = $product->images()->whereNull('variant_id')->where('uuid', $imageId)->first();

        if (! $image) {
            throw new DomainException('Product image not found.', 404);
        }

        DB::transaction(function () use ($product, $image): void {
            $wasPrimary = (bool) $image->is_primary;
            $image->delete();

            $remaining = $product->images()->whereNull('variant_id')->orderBy('sort_order')->get();
            foreach ($remaining as $index => $remainingImage) {
                $remainingImage->update([
                    'sort_order' => $index,
                    'is_primary' => $wasPrimary ? $index === 0 : (bool) $remainingImage->is_primary,
                ]);
            }
        });

        $product->load(['category', 'brand', 'images', 'primaryImage', 'variants', 'attributes.values']);

        return Response::success(new ProductResource($product), 'Product image removed.');
    }

    public function submit(Request $request, string $productId): JsonResponse
    {
        $vendor = $this->vendorFor($request);
        $product = $this->findOwned($vendor->id, $productId);

        $product = $this->service->submitForReview($request->user(), $product);

        return Response::success(new ProductResource($product), 'Product submitted for review.');
    }

    public function destroy(Request $request, string $productId): JsonResponse
    {
        $vendor = $this->vendorFor($request);
        $product = $this->findOwned($vendor->id, $productId);

        $this->service->deleteProduct($request->user(), $product);

        return Response::success(null, 'Product deleted.');
    }

    public function requestBrand(BrandRequestCreateRequest $request): JsonResponse
    {
        $brandRequest = $this->service->requestBrand($request->user(), BrandRequestDTO::fromArray($request->validated()));

        return Response::success(new BrandRequestResource($brandRequest), 'Brand request submitted.', [], 201);
    }

    public function myBrandRequests(Request $request): JsonResponse
    {
        $vendor = $this->vendorFor($request);

        $requests = BrandRequest::query()
            ->where('vendor_id', $vendor->id)
            ->with('brand')
            ->orderByDesc('created_at')
            ->get();

        return Response::success(BrandRequestResource::collection($requests), 'Brand requests retrieved.');
    }

    protected function vendorFor(Request $request)
    {
        $vendor = $request->user()->vendor;

        if (! $vendor) {
            throw new DomainException('You must apply for a vendor account first.', 422);
        }

        return $vendor;
    }

    protected function findOwned(int $vendorId, string $productId): Product
    {
        $product = Product::query()->where('uuid', $productId)->where('vendor_id', $vendorId)->first();

        if (! $product) {
            throw new DomainException('Product not found.', 404);
        }

        return $product;
    }
}
