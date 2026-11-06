#include <jni.h>
#include <android/native_window_jni.h>
#include <android/log.h>
#define VK_USE_PLATFORM_ANDROID_KHR
#include <vulkan/vulkan.h>
#include <vulkan/vulkan_android.h>
#include <vector>
#include <array>
#include <cstring>
#include <cstdint>

#define LOG_TAG "FoliaVulkan"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {
struct State {
    VkInstance instance{VK_NULL_HANDLE};
    VkSurfaceKHR surface{VK_NULL_HANDLE};
    VkPhysicalDevice physical{VK_NULL_HANDLE};
    VkDevice device{VK_NULL_HANDLE};
    uint32_t queueFamily{0};
    VkQueue queue{VK_NULL_HANDLE};
    VkSwapchainKHR swapchain{VK_NULL_HANDLE};
    VkFormat format{VK_FORMAT_R8G8B8A8_UNORM};
    VkExtent2D extent{0, 0};
    std::vector<VkImage> images;
    std::vector<VkImageView> views;
    VkRenderPass renderPass{VK_NULL_HANDLE};
    std::vector<VkFramebuffer> framebuffers;
    VkCommandPool commandPool{VK_NULL_HANDLE};
    std::vector<VkCommandBuffer> commands;
    VkSemaphore imageAvailable{VK_NULL_HANDLE};
    VkSemaphore renderFinished{VK_NULL_HANDLE};
    VkFence inFlight{VK_NULL_HANDLE};
    float hue{0.0f};
};

State* state = nullptr;

bool ok(VkResult result, const char* what) {
    if (result != VK_SUCCESS) { LOGE("%s failed: %d", what, result); return false; }
    return true;
}

uint32_t findQueue(VkPhysicalDevice device, VkSurfaceKHR surface) {
    uint32_t count = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(device, &count, nullptr);
    std::vector<VkQueueFamilyProperties> families(count);
    vkGetPhysicalDeviceQueueFamilyProperties(device, &count, families.data());
    for (uint32_t i = 0; i < count; ++i) {
        VkBool32 present = VK_FALSE;
        vkGetPhysicalDeviceSurfaceSupportKHR(device, i, surface, &present);
        if ((families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) && present) return i;
    }
    return UINT32_MAX;
}

void destroySwapchain(State& s) {
    if (s.device == VK_NULL_HANDLE) return;
    vkDeviceWaitIdle(s.device);
    for (auto fb : s.framebuffers) vkDestroyFramebuffer(s.device, fb, nullptr);
    s.framebuffers.clear();
    if (s.renderPass) vkDestroyRenderPass(s.device, s.renderPass, nullptr);
    s.renderPass = VK_NULL_HANDLE;
    for (auto v : s.views) vkDestroyImageView(s.device, v, nullptr);
    s.views.clear();
    if (s.swapchain) vkDestroySwapchainKHR(s.device, s.swapchain, nullptr);
    s.swapchain = VK_NULL_HANDLE;
    s.images.clear();
}

bool createSwapchain(State& s) {
    VkSurfaceCapabilitiesKHR caps{};
    vkGetPhysicalDeviceSurfaceCapabilitiesKHR(s.physical, s.surface, &caps);
    uint32_t formatCount = 0;
    vkGetPhysicalDeviceSurfaceFormatsKHR(s.physical, s.surface, &formatCount, nullptr);
    std::vector<VkSurfaceFormatKHR> formats(formatCount);
    vkGetPhysicalDeviceSurfaceFormatsKHR(s.physical, s.surface, &formatCount, formats.data());
    VkSurfaceFormatKHR chosen = formats.empty() ? VkSurfaceFormatKHR{s.format, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR} : formats[0];
    for (auto f : formats) {
        if (f.format == VK_FORMAT_R8G8B8A8_UNORM || f.format == VK_FORMAT_B8G8R8A8_UNORM) { chosen = f; break; }
    }
    s.format = chosen.format;
    s.extent = caps.currentExtent;
    if (s.extent.width == UINT32_MAX) {
        s.extent.width = 1080;
        s.extent.height = 1920;
    }
    if (s.extent.width == 0 || s.extent.height == 0) return false;
    uint32_t imageCount = caps.minImageCount + 1;
    if (caps.maxImageCount > 0 && imageCount > caps.maxImageCount) imageCount = caps.maxImageCount;
    VkSwapchainCreateInfoKHR info{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
    info.surface = s.surface;
    info.minImageCount = imageCount;
    info.imageFormat = s.format;
    info.imageColorSpace = chosen.colorSpace;
    info.imageExtent = s.extent;
    info.imageArrayLayers = 1;
    info.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    info.preTransform = caps.currentTransform;
    info.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    info.presentMode = VK_PRESENT_MODE_FIFO_KHR;
    info.clipped = VK_TRUE;
    if (!ok(vkCreateSwapchainKHR(s.device, &info, nullptr, &s.swapchain), "swapchain")) return false;
    uint32_t count = 0;
    vkGetSwapchainImagesKHR(s.device, s.swapchain, &count, nullptr);
    s.images.resize(count);
    vkGetSwapchainImagesKHR(s.device, s.swapchain, &count, s.images.data());
    VkAttachmentDescription color{};
    color.format = s.format;
    color.samples = VK_SAMPLE_COUNT_1_BIT;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    color.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    VkAttachmentReference ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &ref;
    VkRenderPassCreateInfo rp{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
    rp.attachmentCount = 1;
    rp.pAttachments = &color;
    rp.subpassCount = 1;
    rp.pSubpasses = &subpass;
    if (!ok(vkCreateRenderPass(s.device, &rp, nullptr, &s.renderPass), "renderPass")) return false;
    s.views.resize(s.images.size());
    s.framebuffers.resize(s.images.size());
    for (size_t i = 0; i < s.images.size(); ++i) {
        VkImageViewCreateInfo view{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        view.image = s.images[i];
        view.viewType = VK_IMAGE_VIEW_TYPE_2D;
        view.format = s.format;
        view.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        if (!ok(vkCreateImageView(s.device, &view, nullptr, &s.views[i]), "imageView")) return false;
        VkFramebufferCreateInfo fb{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
        fb.renderPass = s.renderPass;
        fb.attachmentCount = 1;
        fb.pAttachments = &s.views[i];
        fb.width = s.extent.width;
        fb.height = s.extent.height;
        fb.layers = 1;
        if (!ok(vkCreateFramebuffer(s.device, &fb, nullptr, &s.framebuffers[i]), "framebuffer")) return false;
    }
    s.commands.resize(s.images.size());
    VkCommandBufferAllocateInfo alloc{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    alloc.commandPool = s.commandPool;
    alloc.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    alloc.commandBufferCount = (uint32_t)s.commands.size();
    if (!ok(vkAllocateCommandBuffers(s.device, &alloc, s.commands.data()), "commands")) return false;
    for (size_t i = 0; i < s.commands.size(); ++i) {
        VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        vkBeginCommandBuffer(s.commands[i], &begin);
        VkClearValue clear{};
        clear.color = {{0.02f, 0.025f, 0.04f, 1.0f}};
        VkRenderPassBeginInfo pass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
        pass.renderPass = s.renderPass;
        pass.framebuffer = s.framebuffers[i];
        pass.renderArea = {{0, 0}, s.extent};
        pass.clearValueCount = 1;
        pass.pClearValues = &clear;
        vkCmdBeginRenderPass(s.commands[i], &pass, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdEndRenderPass(s.commands[i]);
        vkEndCommandBuffer(s.commands[i]);
    }
    return true;
}

bool createDevice(State& s, ANativeWindow* window) {
    VkAndroidSurfaceCreateInfoKHR surfaceInfo{VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR};
    surfaceInfo.window = window;
    if (!ok(vkCreateAndroidSurfaceKHR(s.instance, &surfaceInfo, nullptr, &s.surface), "androidSurface")) return false;
    uint32_t count = 0;
    vkEnumeratePhysicalDevices(s.instance, &count, nullptr);
    std::vector<VkPhysicalDevice> devices(count);
    vkEnumeratePhysicalDevices(s.instance, &count, devices.data());
    for (auto d : devices) {
        uint32_t q = findQueue(d, s.surface);
        if (q != UINT32_MAX) { s.physical = d; s.queueFamily = q; break; }
    }
    if (!s.physical) return false;
    float priority = 1.0f;
    VkDeviceQueueCreateInfo q{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    q.queueFamilyIndex = s.queueFamily;
    q.queueCount = 1;
    q.pQueuePriorities = &priority;
    const char* ext[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
    VkDeviceCreateInfo info{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    info.queueCreateInfoCount = 1;
    info.pQueueCreateInfos = &q;
    info.enabledExtensionCount = 1;
    info.ppEnabledExtensionNames = ext;
    if (!ok(vkCreateDevice(s.physical, &info, nullptr, &s.device), "device")) return false;
    vkGetDeviceQueue(s.device, s.queueFamily, 0, &s.queue);
    VkCommandPoolCreateInfo pool{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    pool.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pool.queueFamilyIndex = s.queueFamily;
    if (!ok(vkCreateCommandPool(s.device, &pool, nullptr, &s.commandPool), "commandPool")) return false;
    VkSemaphoreCreateInfo sem{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
    VkFenceCreateInfo fence{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    fence.flags = VK_FENCE_CREATE_SIGNALED_BIT;
    if (!ok(vkCreateSemaphore(s.device, &sem, nullptr, &s.imageAvailable), "sem")) return false;
    if (!ok(vkCreateSemaphore(s.device, &sem, nullptr, &s.renderFinished), "sem")) return false;
    if (!ok(vkCreateFence(s.device, &fence, nullptr, &s.inFlight), "fence")) return false;
    return createSwapchain(s);
}
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeCreate(JNIEnv* env, jobject, jobject surface) {
    if (!surface) return 0;
    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    if (!window) return 0;
    State* s = new State();
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "Folia";
    app.apiVersion = VK_API_VERSION_1_1;
    VkInstanceCreateInfo info{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    info.pApplicationInfo = &app;
    const char* extensions[] = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME};
    info.enabledExtensionCount = 2;
    info.ppEnabledExtensionNames = extensions;
    if (!ok(vkCreateInstance(&info, nullptr, &s->instance), "instance") ||
        !createDevice(*s, window)) {
        delete s;
        ANativeWindow_release(window);
        return 0;
    }
    ANativeWindow_release(window);
    state = s;
    return reinterpret_cast<jlong>(s);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeRender(JNIEnv*, jobject) {
    State* s = state;
    if (!s || !s->device) return JNI_FALSE;
    vkWaitForFences(s->device, 1, &s->inFlight, VK_TRUE, UINT64_MAX);
    vkResetFences(s->device, 1, &s->inFlight);
    uint32_t imageIndex = 0;
    VkResult result = vkAcquireNextImageKHR(s->device, s->swapchain, UINT64_MAX, s->imageAvailable, VK_NULL_HANDLE, &imageIndex);
    if (result != VK_SUCCESS) return JNI_FALSE;
    VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    submit.waitSemaphoreCount = 1;
    submit.pWaitSemaphores = &s->imageAvailable;
    submit.pWaitDstStageMask = &waitStage;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &s->commands[imageIndex];
    submit.signalSemaphoreCount = 1;
    submit.pSignalSemaphores = &s->renderFinished;
    if (!ok(vkQueueSubmit(s->queue, 1, &submit, s->inFlight), "submit")) return JNI_FALSE;
    VkPresentInfoKHR present{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &s->renderFinished;
    present.swapchainCount = 1;
    present.pSwapchains = &s->swapchain;
    present.pImageIndices = &imageIndex;
    vkQueuePresentKHR(s->queue, &present);
    return JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeDestroy(JNIEnv*, jobject) {
    State* s = state;
    if (!s) return;
    if (s->device) {
        vkDeviceWaitIdle(s->device);
        destroySwapchain(*s);
        if (s->inFlight) vkDestroyFence(s->device, s->inFlight, nullptr);
        if (s->imageAvailable) vkDestroySemaphore(s->device, s->imageAvailable, nullptr);
        if (s->renderFinished) vkDestroySemaphore(s->device, s->renderFinished, nullptr);
        if (s->commandPool) vkDestroyCommandPool(s->device, s->commandPool, nullptr);
        vkDestroyDevice(s->device, nullptr);
    }
    if (s->surface) vkDestroySurfaceKHR(s->instance, s->surface, nullptr);
    if (s->instance) vkDestroyInstance(s->instance, nullptr);
    delete s;
    state = nullptr;
}
