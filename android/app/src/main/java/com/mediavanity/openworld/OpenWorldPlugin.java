// Android twin of ios/App/App/OpenWorldPlugin.swift (jsName "OpenWorld"): the tip jar, as consumable one-time
// products in Play Billing 9. From the web-app-to-google-play skill template.
//   tipProducts() -> { products:[{id,name,price,value}], problem }
//   tip({id}) -> { ok?, cancelled?, pending?, error?, detail? }
package com.mediavanity.openworld;



import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClient.BillingResponseCode;
import com.android.billingclient.api.BillingClient.ProductType;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

@CapacitorPlugin(name = "OpenWorld")
public class OpenWorldPlugin extends Plugin implements PurchasesUpdatedListener {

    static final String PRO = "";   // no Pro in this app: tips only
    static final List<String> TIPS = Arrays.asList(
        "com.mediavanity.openworld.tip.small", "com.mediavanity.openworld.tip.medium", "com.mediavanity.openworld.tip.large");
    
    private BillingClient billing;
    private final Map<String, ProductDetails> details = new HashMap<>();
    private String problem = "";
    // The purchase in flight: Play answers in onPurchasesUpdated, not in launchBillingFlow.
    private PluginCall flowCall;
    private String flowProduct;

    @Override
    public void load() {
        billing = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // Purchases that completed while the app was away (pending payments, other devices):
        // acknowledge Pro and tell the page; consume tips, or they could never be given again.
        if (billing == null) return;
        connected(() -> billing.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build(),
            (r, purchases) -> {
                boolean owned = false;
                for (Purchase p : purchases) {
                    if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                    if (p.getProducts().contains(PRO)) { owned = true; acknowledge(p); }
                    else if (!java.util.Collections.disjoint(p.getProducts(), TIPS))
                        billing.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), (cr, t) -> {});
                }
                if (!PRO.isEmpty()) notifyListeners("proChanged", pro(owned));
            }), err -> {});
    }

    // ---------- connection and lookups ----------

    private void connected(Runnable ok, Consumer<String> fail) {
        if (billing.isReady()) { ok.run(); return; }
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingResponseCode.OK) ok.run();
                else fail.accept("Google Play billing: " + r.getDebugMessage() + " (" + r.getResponseCode() + ")");
            }
            @Override public void onBillingServiceDisconnected() { /* auto reconnection is enabled */ }
        });
    }

    private void lookup(List<String> ids, Consumer<List<ProductDetails>> done) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids) products.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(id).setProductType(ProductType.INAPP).build());
        connected(() -> billing.queryProductDetailsAsync(
            QueryProductDetailsParams.newBuilder().setProductList(products).build(),
            (r, result) -> {
                List<ProductDetails> list = result.getProductDetailsList();
                for (ProductDetails d : list) details.put(d.getProductId(), d);
                problem = r.getResponseCode() != BillingResponseCode.OK ? "Google Play: " + r.getDebugMessage()
                    : list.isEmpty() ? "Google Play returned no product (not active, or app not installed from Play)" : "";
                done.accept(list);
            }), err -> { problem = err; done.accept(new ArrayList<>()); });
    }

    private void ownsPro(Consumer<Boolean> done) {
        connected(() -> billing.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build(),
            (r, purchases) -> {
                boolean owned = false;
                for (Purchase p : purchases) {
                    if (p.getProducts().contains(PRO) && p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        owned = true;
                        acknowledge(p);
                    }
                }
                done.accept(owned);
            }), err -> done.accept(false));
    }

    private void acknowledge(Purchase p) {
        if (p.isAcknowledged()) return;
        billing.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), r -> {});
    }

    private static JSObject pro(boolean owned) { JSObject o = new JSObject(); o.put("pro", owned); return o; }

    // ---------- tips ----------

    @PluginMethod
    public void tipProducts(PluginCall call) {
        lookup(TIPS, list -> {
            JSArray arr = new JSArray();
            for (String id : TIPS) {   // keep the app's order
                ProductDetails d = details.get(id);
                if (d == null || d.getOneTimePurchaseOfferDetails() == null) continue;
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("name", d.getName());
                o.put("price", d.getOneTimePurchaseOfferDetails().getFormattedPrice());
                o.put("value", d.getOneTimePurchaseOfferDetails().getPriceAmountMicros() / 1_000_000.0);
                arr.put(o);
            }
            JSObject out = new JSObject();
            out.put("products", arr);
            out.put("problem", problem);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void tip(PluginCall call) {
        String id = call.getString("id", "");
        if (!TIPS.contains(id)) { JSObject o = new JSObject(); o.put("error", "unknown product"); call.resolve(o); return; }
        launch(call, id);
    }

    // ---------- purchase flow (Pro and tips) ----------

    private void launch(PluginCall call, String id) {
        boolean isPro = id.equals(PRO);
        if (flowCall != null) { call.resolve(fail(isPro, "busy", "another purchase is open")); return; }
        Runnable go = () -> {
            ProductDetails d = details.get(id);
            if (d == null) { call.resolve(fail(isPro, "unavailable", problem)); return; }
            if (isPro) { JSObject s = new JSObject(); s.put("step", "found"); notifyListeners("proStep", s); }
            flowCall = call;
            flowProduct = id;
            getActivity().runOnUiThread(() -> {
                BillingFlowParams.ProductDetailsParams.Builder pd =
                    BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d);
                if (d.getOneTimePurchaseOfferDetails() != null && d.getOneTimePurchaseOfferDetails().getOfferToken() != null)
                    pd.setOfferToken(d.getOneTimePurchaseOfferDetails().getOfferToken());
                BillingResult r = billing.launchBillingFlow(getActivity(),
                    BillingFlowParams.newBuilder().setProductDetailsParamsList(List.of(pd.build())).build());
                if (r.getResponseCode() != BillingResponseCode.OK) onPurchasesUpdated(r, null);
            });
        };
        if (details.containsKey(id)) go.run(); else lookup(isPro ? List.of(PRO) : TIPS, list -> go.run());
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        PluginCall call = flowCall;
        String id = flowProduct;
        flowCall = null;
        flowProduct = null;
        boolean isPro = PRO.equals(id);
        int code = r.getResponseCode();

        if (code == BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) {
                if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
                    if (call != null) { JSObject o = isPro ? pro(false) : new JSObject(); o.put("pending", true); call.resolve(o); }
                    return;
                }
                if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                if (p.getProducts().contains(PRO)) {
                    acknowledge(p);
                    notifyListeners("proChanged", pro(true));
                    if (call != null && isPro) call.resolve(pro(true));
                } else {
                    // A tip: consume it so it can be given again, then answer.
                    billing.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
                        (cr, token) -> {
                            if (call == null) return;
                            JSObject o = new JSObject();
                            if (cr.getResponseCode() == BillingResponseCode.OK) o.put("ok", true);
                            else { o.put("error", "consume failed"); o.put("detail", cr.getDebugMessage()); }
                            call.resolve(o);
                        });
                }
            }
            return;
        }
        if (call == null) return;   // an update with no call waiting (handled on resume)
        if (code == BillingResponseCode.USER_CANCELED) {
            JSObject o = isPro ? pro(false) : new JSObject(); o.put("cancelled", true); call.resolve(o);
        } else if (code == BillingResponseCode.ITEM_ALREADY_OWNED && isPro) {
            ownsPro(owned -> call.resolve(pro(owned)));
        } else {
            call.resolve(fail(isPro, "failed", r.getDebugMessage() + " (" + code + ")"));
        }
    }

    private static JSObject fail(boolean isPro, String error, String detail) {
        JSObject o = isPro ? pro(false) : new JSObject();
        o.put("error", error);
        o.put("detail", detail);
        return o;
    }

}
