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
#include <chrono>
#include <cmath>
#include "stage_spv.h"

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
    VkPipelineLayout pipelineLayout{VK_NULL_HANDLE};
    VkPipelineLayout simplePipelineLayout{VK_NULL_HANDLE};
    bool simplePipeline{false};
    VkPipeline pipeline{VK_NULL_HANDLE};
    VkShaderModule vertModule{VK_NULL_HANDLE};
    VkShaderModule fragModule{VK_NULL_HANDLE};
    VkShaderModule textVertModule{VK_NULL_HANDLE};
    VkShaderModule textFragModule{VK_NULL_HANDLE};
    VkBuffer textVertexBuffer{VK_NULL_HANDLE};
    VkDeviceMemory textVertexMemory{VK_NULL_HANDLE};
    VkDeviceSize textVertexCapacity{0};
    uint32_t textVertexCount{0};
    VkImage textImage{VK_NULL_HANDLE};
    VkDeviceMemory textMemory{VK_NULL_HANDLE};
    VkImageView textView{VK_NULL_HANDLE};
    VkSampler textSampler{VK_NULL_HANDLE};
    VkDescriptorSetLayout descriptorLayout{VK_NULL_HANDLE};
    VkDescriptorPool descriptorPool{VK_NULL_HANDLE};
    VkDescriptorSet descriptorSet{VK_NULL_HANDLE};
    VkPipelineLayout textPipelineLayout{VK_NULL_HANDLE};
    VkPipeline textPipeline{VK_NULL_HANDLE};
    uint32_t textWidth{1};
    uint32_t textHeight{1};
    std::vector<VkFramebuffer> framebuffers;
    VkCommandPool commandPool{VK_NULL_HANDLE};
    VkDebugUtilsMessengerEXT debugMessenger{VK_NULL_HANDLE};
    std::vector<VkCommandBuffer> commands;
    VkSemaphore imageAvailable{VK_NULL_HANDLE};
    VkSemaphore renderFinished{VK_NULL_HANDLE};
    VkFence inFlight{VK_NULL_HANDLE};
    float hue{0.0f};
    float accent[4]{0.49f, 0.61f, 1.0f, 1.0f};
    float power{0.0f};
    int mode{0};
    bool daylight{false};
};

State* state = nullptr;
std::string lastError;

VKAPI_ATTR VkBool32 VKAPI_CALL debugCallback(
        VkDebugUtilsMessageSeverityFlagBitsEXT,
        VkDebugUtilsMessageTypeFlagsEXT,
        const VkDebugUtilsMessengerCallbackDataEXT* data,
        void*) {
    if (data && data->pMessage) lastError = std::string("validation: ") + data->pMessage;
    return VK_FALSE;
}

bool ok(VkResult result, const char* what) {
    if (result != VK_SUCCESS) {
        lastError = std::string(what) + " failed: " + std::to_string((int) result);
        LOGE("%s failed: %d", what, result);
        return false;
    }
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

uint32_t memoryType(State& s, uint32_t bits, VkMemoryPropertyFlags flags) {
    VkPhysicalDeviceMemoryProperties props{};
    vkGetPhysicalDeviceMemoryProperties(s.physical, &props);
    for (uint32_t i = 0; i < props.memoryTypeCount; ++i) {
        if ((bits & (1u << i)) && (props.memoryTypes[i].propertyFlags & flags) == flags) return i;
    }
    return 0;
}

void destroyTexture(State& s) {
    if (s.textView) vkDestroyImageView(s.device, s.textView, nullptr);
    if (s.textImage) vkDestroyImage(s.device, s.textImage, nullptr);
    if (s.textMemory) vkFreeMemory(s.device, s.textMemory, nullptr);
    s.textView = VK_NULL_HANDLE;
    s.textImage = VK_NULL_HANDLE;
    s.textMemory = VK_NULL_HANDLE;
}

bool createTexture(State& s, uint32_t width, uint32_t height, const uint32_t* pixels) {
    destroyTexture(s);
    VkImageCreateInfo image{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
    image.imageType = VK_IMAGE_TYPE_2D;
    image.extent = {width, height, 1};
    image.mipLevels = 1;
    image.arrayLayers = 1;
    image.format = VK_FORMAT_R8G8B8A8_UNORM;
    image.tiling = VK_IMAGE_TILING_OPTIMAL;
    image.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    image.usage = VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
    image.samples = VK_SAMPLE_COUNT_1_BIT;
    image.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (!ok(vkCreateImage(s.device, &image, nullptr, &s.textImage), "textImage")) return false;
    VkMemoryRequirements req{};
    vkGetImageMemoryRequirements(s.device, s.textImage, &req);
    VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    alloc.allocationSize = req.size;
    alloc.memoryTypeIndex = memoryType(s, req.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (!ok(vkAllocateMemory(s.device, &alloc, nullptr, &s.textMemory), "textMemory")) return false;
    vkBindImageMemory(s.device, s.textImage, s.textMemory, 0);
    VkImageViewCreateInfo view{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    view.image = s.textImage;
    view.viewType = VK_IMAGE_VIEW_TYPE_2D;
    view.format = VK_FORMAT_R8G8B8A8_UNORM;
    view.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    if (!ok(vkCreateImageView(s.device, &view, nullptr, &s.textView), "textView")) return false;
    VkBuffer staging = VK_NULL_HANDLE;
    VkDeviceMemory stagingMemory = VK_NULL_HANDLE;
    VkBufferCreateInfo buffer{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    buffer.size = (VkDeviceSize) width * height * 4;
    buffer.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    buffer.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (!ok(vkCreateBuffer(s.device, &buffer, nullptr, &staging), "staging")) return false;
    VkMemoryRequirements stagingReq{};
    vkGetBufferMemoryRequirements(s.device, staging, &stagingReq);
    VkMemoryAllocateInfo stagingAlloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    stagingAlloc.allocationSize = stagingReq.size;
    stagingAlloc.memoryTypeIndex = memoryType(s, stagingReq.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (!ok(vkAllocateMemory(s.device, &stagingAlloc, nullptr, &stagingMemory), "stagingMemory")) return false;
    vkBindBufferMemory(s.device, staging, stagingMemory, 0);
    void* mapped = nullptr;
    vkMapMemory(s.device, stagingMemory, 0, buffer.size, 0, &mapped);
    if (pixels) memcpy(mapped, pixels, (size_t) buffer.size);
    else memset(mapped, 0, (size_t) buffer.size);
    vkUnmapMemory(s.device, stagingMemory);
    VkCommandBuffer cmd = s.commands.empty() ? VK_NULL_HANDLE : s.commands[0];
    if (cmd != VK_NULL_HANDLE) {
        vkResetCommandBuffer(cmd, 0);
        VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        vkBeginCommandBuffer(cmd, &begin);
        VkImageMemoryBarrier toDst{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        toDst.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        toDst.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        toDst.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        toDst.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        toDst.image = s.textImage;
        toDst.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        toDst.srcAccessMask = 0;
        toDst.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &toDst);
        VkBufferImageCopy copy{};
        copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
        copy.imageExtent = {width, height, 1};
        vkCmdCopyBufferToImage(cmd, staging, s.textImage, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &copy);
        VkImageMemoryBarrier toRead{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        toRead.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        toRead.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        toRead.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        toRead.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        toRead.image = s.textImage;
        toRead.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        toRead.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        toRead.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, 0, 0, nullptr, 0, nullptr, 1, &toRead);
        vkEndCommandBuffer(cmd);
        VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        submit.commandBufferCount = 1;
        submit.pCommandBuffers = &cmd;
        vkQueueSubmit(s.queue, 1, &submit, VK_NULL_HANDLE);
        vkQueueWaitIdle(s.queue);
    }
    vkDestroyBuffer(s.device, staging, nullptr);
    vkFreeMemory(s.device, stagingMemory, nullptr);
    s.textWidth = width;
    s.textHeight = height;
    if (s.descriptorSet != VK_NULL_HANDLE) {
        VkDescriptorImageInfo imageInfo{s.textSampler, s.textView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL};
        VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
        write.dstSet = s.descriptorSet;
        write.dstBinding = 0;
        write.descriptorCount = 1;
        write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        write.pImageInfo = &imageInfo;
        vkUpdateDescriptorSets(s.device, 1, &write, 0, nullptr);
    }
    return true;
}

VkShaderModule shaderModule(State& s, const uint32_t* code, size_t size) {
    VkShaderModuleCreateInfo info{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    info.codeSize = size;
    info.pCode = code;
    VkShaderModule module = VK_NULL_HANDLE;
    ok(vkCreateShaderModule(s.device, &info, nullptr, &module), "shaderModule");
    return module;
}

bool createTextResources(State& s) {
    VkDescriptorSetLayoutBinding binding{0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_FRAGMENT_BIT, nullptr};
    VkDescriptorSetLayoutCreateInfo layout{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    layout.bindingCount = 1;
    layout.pBindings = &binding;
    if (!ok(vkCreateDescriptorSetLayout(s.device, &layout, nullptr, &s.descriptorLayout), "descriptorLayout")) return false;
    VkSamplerCreateInfo sampler{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
    sampler.magFilter = VK_FILTER_LINEAR;
    sampler.minFilter = VK_FILTER_LINEAR;
    sampler.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    if (!ok(vkCreateSampler(s.device, &sampler, nullptr, &s.textSampler), "sampler")) return false;
    VkDescriptorPoolSize size{VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1};
    VkDescriptorPoolCreateInfo pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
    pool.maxSets = 1;
    pool.poolSizeCount = 1;
    pool.pPoolSizes = &size;
    if (!ok(vkCreateDescriptorPool(s.device, &pool, nullptr, &s.descriptorPool), "descriptorPool")) return false;
    VkDescriptorSetAllocateInfo alloc{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    alloc.descriptorPool = s.descriptorPool;
    alloc.descriptorSetCount = 1;
    alloc.pSetLayouts = &s.descriptorLayout;
    if (!ok(vkAllocateDescriptorSets(s.device, &alloc, &s.descriptorSet), "descriptorSet")) return false;
    return createTexture(s, 1, 1, nullptr);
}

bool ensureTextBuffer(State& s, VkDeviceSize size) {
    if (size <= s.textVertexCapacity && s.textVertexBuffer != VK_NULL_HANDLE) return true;
    if (s.textVertexBuffer) vkDestroyBuffer(s.device, s.textVertexBuffer, nullptr);
    if (s.textVertexMemory) vkFreeMemory(s.device, s.textVertexMemory, nullptr);
    s.textVertexBuffer = VK_NULL_HANDLE;
    s.textVertexMemory = VK_NULL_HANDLE;
    VkDeviceSize capacity = size < 4096 ? 4096 : size;
    VkBufferCreateInfo info{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    info.size = capacity;
    info.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (!ok(vkCreateBuffer(s.device, &info, nullptr, &s.textVertexBuffer), "textVertexBuffer")) return false;
    VkMemoryRequirements req{};
    vkGetBufferMemoryRequirements(s.device, s.textVertexBuffer, &req);
    VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    alloc.allocationSize = req.size;
    alloc.memoryTypeIndex = memoryType(s, req.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (!ok(vkAllocateMemory(s.device, &alloc, nullptr, &s.textVertexMemory), "textVertexMemory")) return false;
    vkBindBufferMemory(s.device, s.textVertexBuffer, s.textVertexMemory, 0);
    s.textVertexCapacity = capacity;
    return true;
}

bool createTextPipeline(State& s) {
    if (!s.textVertModule) s.textVertModule = shaderModule(s, kTextVertSpv, kTextVertSpvSize);
    if (!s.textFragModule) s.textFragModule = shaderModule(s, kTextFragSpv, kTextFragSpvSize);
    if (!s.textVertModule || !s.textFragModule) return false;
    VkPushConstantRange push{};
    push.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    push.offset = 0;
    push.size = 16;
    VkPipelineLayoutCreateInfo layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    layout.setLayoutCount = 1;
    layout.pSetLayouts = &s.descriptorLayout;
    layout.pushConstantRangeCount = 1;
    layout.pPushConstantRanges = &push;
    if (!ok(vkCreatePipelineLayout(s.device, &layout, nullptr, &s.textPipelineLayout), "textPipelineLayout")) return false;
    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = s.textVertModule;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = s.textFragModule;
    stages[1].pName = "main";
    VkVertexInputBindingDescription binding{0, 32, VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attrs[3]{};
    attrs[0] = {0, 0, VK_FORMAT_R32G32_SFLOAT, 0};
    attrs[1] = {1, 0, VK_FORMAT_R32G32_SFLOAT, 8};
    attrs[2] = {2, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 16};
    VkPipelineVertexInputStateCreateInfo vertex{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    vertex.vertexBindingDescriptionCount = 1;
    vertex.pVertexBindingDescriptions = &binding;
    vertex.vertexAttributeDescriptionCount = 3;
    vertex.pVertexAttributeDescriptions = attrs;
    VkPipelineInputAssemblyStateCreateInfo assembly{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
    assembly.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    VkViewport staticViewport{0.0f, 0.0f, (float) s.extent.width, (float) s.extent.height, 0.0f, 1.0f};
    VkRect2D staticScissor{{0, 0}, s.extent};
    VkPipelineViewportStateCreateInfo viewport{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
    viewport.viewportCount = 1;
    viewport.pViewports = &staticViewport;
    viewport.scissorCount = 1;
    viewport.pScissors = &staticScissor;
    VkPipelineRasterizationStateCreateInfo raster{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
    raster.polygonMode = VK_POLYGON_MODE_FILL;
    raster.cullMode = VK_CULL_MODE_NONE;
    raster.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    raster.lineWidth = 1.0f;
    VkPipelineMultisampleStateCreateInfo multisample{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
    multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    VkPipelineColorBlendAttachmentState blend{};
    blend.blendEnable = VK_TRUE;
    blend.srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
    blend.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    blend.colorBlendOp = VK_BLEND_OP_ADD;
    blend.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    blend.dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    blend.alphaBlendOp = VK_BLEND_OP_ADD;
    blend.colorWriteMask = 0xF;
    VkPipelineColorBlendStateCreateInfo color{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
    color.attachmentCount = 1;
    color.pAttachments = &blend;
    VkDynamicState dynamicStates[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dynamic{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
    dynamic.dynamicStateCount = 2;
    dynamic.pDynamicStates = dynamicStates;
    VkPipelineDepthStencilStateCreateInfo depth{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
    depth.depthTestEnable = VK_FALSE;
    depth.depthWriteEnable = VK_FALSE;
    depth.stencilTestEnable = VK_FALSE;
    VkGraphicsPipelineCreateInfo info{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
    info.flags = VK_PIPELINE_CREATE_DISABLE_OPTIMIZATION_BIT;
    info.stageCount = 2;
    info.pStages = stages;
    info.pVertexInputState = &vertex;
    info.pInputAssemblyState = &assembly;
    info.pViewportState = &viewport;
    info.pRasterizationState = &raster;
    info.pMultisampleState = &multisample;
    info.pDepthStencilState = &depth;
    info.pColorBlendState = &color;
    info.pDynamicState = &dynamic;
    info.layout = s.textPipelineLayout;
    info.renderPass = s.renderPass;
    info.subpass = 0;
    VkResult textResult = vkCreateGraphicsPipelines(s.device, VK_NULL_HANDLE, 1, &info, nullptr, &s.textPipeline);
    LOGE("text pipeline result=%d", (int) textResult);
    return ok(textResult, "textPipeline");
}

bool createPipeline(State& s) {
    if (!s.vertModule) s.vertModule = shaderModule(s, kStageVertSpv, kStageVertSpvSize);
    if (!s.fragModule) s.fragModule = shaderModule(s, kStageFragSpv, kStageFragSpvSize);
    if (!s.vertModule || !s.fragModule) return false;
    VkPushConstantRange push{};
    push.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    push.offset = 0;
    push.size = 32;
    VkPipelineLayoutCreateInfo layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    layout.pushConstantRangeCount = 1;
    layout.pPushConstantRanges = &push;
    if (!ok(vkCreatePipelineLayout(s.device, &layout, nullptr, &s.pipelineLayout), "pipelineLayout")) return false;
    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = s.vertModule;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = s.fragModule;
    stages[1].pName = "main";
    VkPipelineVertexInputStateCreateInfo vertex{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    VkPipelineInputAssemblyStateCreateInfo assembly{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
    assembly.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    VkViewport staticViewport{0.0f, 0.0f, (float) s.extent.width, (float) s.extent.height, 0.0f, 1.0f};
    VkRect2D staticScissor{{0, 0}, s.extent};
    VkPipelineViewportStateCreateInfo viewport{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
    viewport.viewportCount = 1;
    viewport.pViewports = &staticViewport;
    viewport.scissorCount = 1;
    viewport.pScissors = &staticScissor;
    VkPipelineRasterizationStateCreateInfo raster{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
    raster.polygonMode = VK_POLYGON_MODE_FILL;
    raster.cullMode = VK_CULL_MODE_NONE;
    raster.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    raster.lineWidth = 1.0f;
    VkPipelineMultisampleStateCreateInfo multisample{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
    multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    VkPipelineColorBlendAttachmentState blend{};
    blend.colorWriteMask = 0xF;
    VkPipelineColorBlendStateCreateInfo color{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
    color.attachmentCount = 1;
    color.pAttachments = &blend;
    VkDynamicState dynamicStates[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dynamic{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
    dynamic.dynamicStateCount = 2;
    dynamic.pDynamicStates = dynamicStates;
    VkPipelineDepthStencilStateCreateInfo depth{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
    depth.depthTestEnable = VK_FALSE;
    depth.depthWriteEnable = VK_FALSE;
    depth.stencilTestEnable = VK_FALSE;
    VkGraphicsPipelineCreateInfo info{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
    info.flags = VK_PIPELINE_CREATE_DISABLE_OPTIMIZATION_BIT;
    info.stageCount = 2;
    info.pStages = stages;
    info.pVertexInputState = &vertex;
    info.pInputAssemblyState = &assembly;
    info.pViewportState = &viewport;
    info.pRasterizationState = &raster;
    info.pMultisampleState = &multisample;
    info.pDepthStencilState = &depth;
    info.pColorBlendState = &color;
    info.layout = s.pipelineLayout;
    info.renderPass = s.renderPass;
    info.subpass = 0;
    VkResult pipelineResult = vkCreateGraphicsPipelines(s.device, VK_NULL_HANDLE, 1, &info, nullptr, &s.pipeline);
    LOGE("background pipeline result=%d format=%d extent=%ux%u", (int) pipelineResult, (int) s.format, s.extent.width, s.extent.height);
    if (pipelineResult != VK_SUCCESS) {
        VkPipelineLayoutCreateInfo simpleLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        if (!ok(vkCreatePipelineLayout(s.device, &simpleLayoutInfo, nullptr, &s.simplePipelineLayout), "simplePipelineLayout")) return false;
        s.vertModule = shaderModule(s, kSimpleVertSpv, kSimpleVertSpvSize);
        s.fragModule = shaderModule(s, kSimpleFragSpv, kSimpleFragSpvSize);
        stages[0].module = s.vertModule;
        stages[1].module = s.fragModule;
        info.layout = s.simplePipelineLayout;
        s.pipeline = VK_NULL_HANDLE;
        pipelineResult = vkCreateGraphicsPipelines(s.device, VK_NULL_HANDLE, 1, &info, nullptr, &s.pipeline);
        LOGE("simple pipeline result=%d format=%d extent=%ux%u", (int) pipelineResult, (int) s.format, s.extent.width, s.extent.height);
        if (pipelineResult != VK_SUCCESS) {
            lastError = "pipeline and simple pipeline failed: " + std::to_string((int) pipelineResult);
            s.pipeline = VK_NULL_HANDLE;
            return true;
        }
        s.simplePipeline = true;
        lastError = "pipeline fallback: simple";
    }
    return true;
}

void destroySwapchain(State& s) {
    if (s.device == VK_NULL_HANDLE) return;
    vkDeviceWaitIdle(s.device);
    for (auto fb : s.framebuffers) vkDestroyFramebuffer(s.device, fb, nullptr);
    s.framebuffers.clear();
    if (s.textPipeline) vkDestroyPipeline(s.device, s.textPipeline, nullptr);
    s.textPipeline = VK_NULL_HANDLE;
    if (s.textPipelineLayout) vkDestroyPipelineLayout(s.device, s.textPipelineLayout, nullptr);
    s.textPipelineLayout = VK_NULL_HANDLE;
    if (s.pipeline) vkDestroyPipeline(s.device, s.pipeline, nullptr);
    s.pipeline = VK_NULL_HANDLE;
    if (s.pipelineLayout) vkDestroyPipelineLayout(s.device, s.pipelineLayout, nullptr);
    if (s.simplePipelineLayout) vkDestroyPipelineLayout(s.device, s.simplePipelineLayout, nullptr);
    s.pipelineLayout = VK_NULL_HANDLE;
    if (s.renderPass) vkDestroyRenderPass(s.device, s.renderPass, nullptr);
    s.renderPass = VK_NULL_HANDLE;
    for (auto v : s.views) vkDestroyImageView(s.device, v, nullptr);
    s.views.clear();
    if (s.swapchain) vkDestroySwapchainKHR(s.device, s.swapchain, nullptr);
    s.swapchain = VK_NULL_HANDLE;
    s.images.clear();
}

void recordClear(State& s, uint32_t imageIndex, float time) {
    VkCommandBuffer cmd = s.commands[imageIndex];
    vkResetCommandBuffer(cmd, 0);
    VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    vkBeginCommandBuffer(cmd, &begin);
    VkClearValue clear{};
    clear.color = {{0.015f, 0.018f, 0.028f, 1.0f}};
    VkRenderPassBeginInfo pass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    pass.renderPass = s.renderPass;
    pass.framebuffer = s.framebuffers[imageIndex];
    pass.renderArea = {{0, 0}, s.extent};
    pass.clearValueCount = 1;
    pass.pClearValues = &clear;
    vkCmdBeginRenderPass(cmd, &pass, VK_SUBPASS_CONTENTS_INLINE);
    if (s.pipeline != VK_NULL_HANDLE) {
        VkViewport viewport{0.0f, 0.0f, (float) s.extent.width, (float) s.extent.height, 0.0f, 1.0f};
        VkRect2D scissor{{0, 0}, s.extent};
        vkCmdSetViewport(cmd, 0, 1, &viewport);
        vkCmdSetScissor(cmd, 0, 1, &scissor);
        struct Push { float time; float power; int mode; float pad; float accent[4]; } push{time, s.power, s.mode, s.daylight ? 1.0f : 0.0f, {s.accent[0], s.accent[1], s.accent[2], s.accent[3]}};
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, s.pipeline);
        if (!s.simplePipeline) vkCmdPushConstants(cmd, s.pipelineLayout, VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(push), &push);
        vkCmdDraw(cmd, 3, 1, 0, 0);
        if (s.textPipeline != VK_NULL_HANDLE && s.descriptorSet != VK_NULL_HANDLE && s.textVertexCount > 0) {
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, s.textPipeline);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, s.textPipelineLayout, 0, 1, &s.descriptorSet, 0, nullptr);
            VkDeviceSize offset = 0;
            vkCmdBindVertexBuffers(cmd, 0, 1, &s.textVertexBuffer, &offset);
            vkCmdDraw(cmd, s.textVertexCount, 1, 0, 0);
        }
    }
    vkCmdEndRenderPass(cmd);
    vkEndCommandBuffer(cmd);
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
    if (s.extent.width == 0 || s.extent.height == 0) { lastError = "swapchain extent 0"; return false; }
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
    createPipeline(s);
    s.commands.resize(s.images.size());
    VkCommandBufferAllocateInfo alloc{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    alloc.commandPool = s.commandPool;
    alloc.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    alloc.commandBufferCount = (uint32_t)s.commands.size();
    if (!ok(vkAllocateCommandBuffers(s.device, &alloc, s.commands.data()), "commands")) return false;
    if (s.descriptorLayout == VK_NULL_HANDLE && !createTextResources(s)) return false;
    if (!createTextPipeline(s)) {
        lastError = lastError.empty() ? "text pipeline skipped" : lastError + "; text pipeline skipped";
    }
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
    if (!s.physical) { lastError = "no vulkan physical device"; return false; }
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

static bool hasInstanceLayer(const char* name) {
    uint32_t count = 0;
    vkEnumerateInstanceLayerProperties(&count, nullptr);
    std::vector<VkLayerProperties> layers(count);
    vkEnumerateInstanceLayerProperties(&count, layers.data());
    for (auto& layer : layers) if (strcmp(layer.layerName, name) == 0) return true;
    return false;
}

static bool hasInstanceExtension(const char* name) {
    uint32_t count = 0;
    vkEnumerateInstanceExtensionProperties(nullptr, &count, nullptr);
    std::vector<VkExtensionProperties> extensions(count);
    vkEnumerateInstanceExtensionProperties(nullptr, &count, extensions.data());
    for (auto& extension : extensions) if (strcmp(extension.extensionName, name) == 0) return true;
    return false;
}

extern "C" JNIEXPORT jlong JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeCreate(JNIEnv* env, jobject, jobject surface) {
    if (!surface) { lastError = "null surface"; return 0; }
    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    if (!window) { lastError = "null native window"; return 0; }
    State* s = new State();
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    app.pApplicationName = "Folia";
    app.apiVersion = VK_API_VERSION_1_0;
    std::vector<const char*> extensions = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME};
    std::vector<const char*> layers;
    bool validation = hasInstanceLayer("VK_LAYER_KHRONOS_validation");
    if (validation) layers.push_back("VK_LAYER_KHRONOS_validation");
    bool debugUtils = hasInstanceExtension(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
    if (debugUtils) extensions.push_back(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
    VkDebugUtilsMessengerCreateInfoEXT debugInfo{VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT};
    debugInfo.messageSeverity = VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT;
    debugInfo.messageType = VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;
    debugInfo.pfnUserCallback = debugCallback;
    VkInstanceCreateInfo info{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    info.pApplicationInfo = &app;
    info.enabledExtensionCount = (uint32_t) extensions.size();
    info.ppEnabledExtensionNames = extensions.data();
    info.enabledLayerCount = (uint32_t) layers.size();
    info.ppEnabledLayerNames = layers.empty() ? nullptr : layers.data();
    if (validation && debugUtils) info.pNext = &debugInfo;
    if (!ok(vkCreateInstance(&info, nullptr, &s->instance), "instance") ||
        !createDevice(*s, window)) {
        if (s->device) {
            vkDeviceWaitIdle(s->device);
            vkDestroyDevice(s->device, nullptr);
            s->device = VK_NULL_HANDLE;
        }
        if (s->surface) {
            vkDestroySurfaceKHR(s->instance, s->surface, nullptr);
            s->surface = VK_NULL_HANDLE;
        }
        if (s->instance) {
            vkDestroyInstance(s->instance, nullptr);
            s->instance = VK_NULL_HANDLE;
        }
        delete s;
        ANativeWindow_release(window);
        return 0;
    }
    if (validation && debugUtils) {
        auto createMessenger = (PFN_vkCreateDebugUtilsMessengerEXT) vkGetInstanceProcAddr(s->instance, "vkCreateDebugUtilsMessengerEXT");
        if (createMessenger) createMessenger(s->instance, &debugInfo, nullptr, &s->debugMessenger);
    }
    ANativeWindow_release(window);
    state = s;
    LOGE("nativeCreate ok format=%d extent=%ux%u", (int) s->format, s->extent.width, s->extent.height);
    return reinterpret_cast<jlong>(s);
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeSetDaylight(JNIEnv*, jobject, jboolean daylight) {
    State* s = state;
    if (s) s->daylight = daylight == JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeSetMode(JNIEnv*, jobject, jint mode) {
    State* s = state;
    if (s) s->mode = mode;
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeSetPower(JNIEnv*, jobject, jfloat power) {
    State* s = state;
    if (s) s->power = power < 0.0f ? 0.0f : (power > 1.0f ? 1.0f : power);
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeSetAccent(JNIEnv*, jobject, jint color) {
    State* s = state;
    if (!s) return;
    s->accent[0] = ((color >> 16) & 0xFF) / 255.0f;
    s->accent[1] = ((color >> 8) & 0xFF) / 255.0f;
    s->accent[2] = (color & 0xFF) / 255.0f;
    s->accent[3] = 1.0f;
}

extern "C" JNIEXPORT jstring JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeLastError(JNIEnv* env, jobject) {
    return env->NewStringUTF(lastError.c_str());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeHasPipeline(JNIEnv*, jobject) {
    State* s = state;
    return (s != nullptr && s->pipeline != VK_NULL_HANDLE) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeReady(JNIEnv*, jobject) {
    State* s = state;
    return (s != nullptr && s->device != VK_NULL_HANDLE) ? JNI_TRUE : JNI_FALSE;
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
    float seconds = (float) (std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count() % 4000) / 4000.0f;
    recordClear(*s, imageIndex, seconds * 6.2831853f);
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
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeUpdateText(JNIEnv* env, jobject, jint w, jint h, jintArray pixels) {
    State* st = state;
    if (!st || !st->device || !st->descriptorSet) return;
    jint* data = env->GetIntArrayElements(pixels, nullptr);
    if (!data) return;
    vkDeviceWaitIdle(st->device);
    createTexture(*st, (uint32_t) w, (uint32_t) h, reinterpret_cast<const uint32_t*>(data));
    env->ReleaseIntArrayElements(pixels, data, JNI_ABORT);
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeUpdateAtlas(JNIEnv* env, jobject, jint width, jint height, jintArray pixels) {
    State* s = state;
    if (!s || !s->device || !pixels) return;
    jint* data = env->GetIntArrayElements(pixels, nullptr);
    vkDeviceWaitIdle(s->device);
    createTexture(*s, (uint32_t) width, (uint32_t) height, reinterpret_cast<const uint32_t*>(data));
    env->ReleaseIntArrayElements(pixels, data, JNI_ABORT);
}

extern "C" JNIEXPORT void JNICALL
Java_top_izuna_foliamajor_FoliaVulkanStageView_nativeUpdateQuads(JNIEnv* env, jobject, jfloatArray data, jint count) {
    State* s = state;
    if (!s || !s->device || !data || count <= 0) return;
    VkDeviceSize size = (VkDeviceSize) count * 8 * sizeof(float);
    if (!ensureTextBuffer(*s, size)) return;
    void* mapped = nullptr;
    vkMapMemory(s->device, s->textVertexMemory, 0, size, 0, &mapped);
    env->GetFloatArrayRegion(data, 0, count * 8, reinterpret_cast<jfloat*>(mapped));
    vkUnmapMemory(s->device, s->textVertexMemory);
    s->textVertexCount = (uint32_t) count;
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
        if (s->vertModule) vkDestroyShaderModule(s->device, s->vertModule, nullptr);
        if (s->fragModule) vkDestroyShaderModule(s->device, s->fragModule, nullptr);
        if (s->textVertModule) vkDestroyShaderModule(s->device, s->textVertModule, nullptr);
        if (s->textFragModule) vkDestroyShaderModule(s->device, s->textFragModule, nullptr);
        if (s->textVertexBuffer) vkDestroyBuffer(s->device, s->textVertexBuffer, nullptr);
        if (s->textVertexMemory) vkFreeMemory(s->device, s->textVertexMemory, nullptr);
        vkDestroyDevice(s->device, nullptr);
    }
    if (s->debugMessenger) {
        auto destroyMessenger = (PFN_vkDestroyDebugUtilsMessengerEXT) vkGetInstanceProcAddr(s->instance, "vkDestroyDebugUtilsMessengerEXT");
        if (destroyMessenger) destroyMessenger(s->instance, s->debugMessenger, nullptr);
    }
    if (s->surface) vkDestroySurfaceKHR(s->instance, s->surface, nullptr);
    if (s->instance) vkDestroyInstance(s->instance, nullptr);
    delete s;
    state = nullptr;
}
